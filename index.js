const _ = require('lodash')
const fs = require('fs')
const path = require('path')
const deploy = require('./src/js/exercise/index')
const blockchain = require('./src/js/exercise/blockchain')
const unescape = require('unescape')
const { JSDOM } = require('jsdom')
const solc = require('solc')

const WEBSITE_TPL = _.template(fs.readFileSync(path.resolve(__dirname, './assets/website.html')))
const EBOOK_TPL = _.template(fs.readFileSync(path.resolve(__dirname, './assets/ebook.html')))

const assertLibrary = fs.readFileSync(path.resolve(__dirname, './src/sol/Assert.sol'), 'utf8')

const isWriteMode = () => {
  return process.env.WRITE_MODE && JSON.parse(process.env.WRITE_MODE)
}

async function deployAssertLibrary () {
  if (isWriteMode()) {
    return
  }
  const input = {
    'Assert.sol': assertLibrary
  }
  const codes = solc.compile({sources: input}, 1)
  this.config.values.variables.assertLibrary = await blockchain.deploy(codes.contracts['Assert.sol:Assert'])
}

/**
 * Manage all pre-operations necessary for the exercise to work
 * @param {{blocks: Array<{name: string, body: string}>}} blk - Information about the block being parsed
 * @returns {string} - HTML code to insert into the webpage
 */
async function processDeployement (blk) {
  const codes = {}

  _.each(blk.blocks, function (_blk) {
    codes[_blk.name] = _blk.body.trim()
  })

  if (codes.title === undefined) {
    codes.title = 'Exercise'
  }

  // To have a quick update on local machine deployment can be disabled
  if (!isWriteMode()) {
    // Compile and deploy test contracts to our blockchain
    codes.deployed = await deploy(codes, { address: this.config.values.variables.assertLibrary, source: assertLibrary })
  } else {
    codes.exerciseId = -1
    codes.deployed = []
  }

  if (codes.hints === undefined) {
    // TODO: when no hints, what shall we do?
    // Rewrite client side verification to include only the abi
  } else {
    codes.hints = await this.book.renderBlock('markdown', codes.hints)
  }

  // Select appropriate template
  const tpl = (this.generator === 'website' ? WEBSITE_TPL : EBOOK_TPL)

  let wording = await this.book.renderBlock('markdown', blk.body)
  wording = wording.replace('<p>', '').replace('</p>', '')
  const { body } = (new JSDOM(`<body>${wording}</body>`)).window.document

  wording = htmlToJson(body).content
  wording = (typeof wording === 'string') ? JSON.stringify(wording) : wording.map(JSON.stringify)

  return tpl({
    message: wording,
    codes: codes
  })
}

const pathToURL = path => path.replace(/README\.md$/i, '').replace(/md$/, 'html')

async function processMain (blk) {
  const result = Object.keys(this.navigation)
    .reduce((acc, path) => {
      const page = this.navigation[path]
      if (page.title.toLowerCase() === 'main') {
        return acc
      }
      const categories = path.includes('/') ? [path.split('/')[1]] : []
      return [{
        title: page.title,
        categories: [],
        updated_on: (new Date(Date.now())).toDateString(),
        summary: null,
        difficulty: null,
        url: pathToURL(path),
        next: page.next && page.next.path ? [pathToURL(page.next.path)] : null,
        previous: page.prev && page.prev.path && categories[0] !== 'Homepage' ? [pathToURL(page.prev.path)] : null
      }, ...acc]
    }, [])

  return JSON.stringify(result, null, '\t')
}

const htmlToJson = (html) => {
  let attributes = []

  if (html.nodeName.toLowerCase() !== 'body' && html.attributes) {
    attributes = [...html.attributes].reduce((acc, attribute) => Object.defineProperty(acc, attribute.nodeName, {
      value: attribute.nodeValue,
      enumerable: true
    }), {})
  }

  if (html.nodeName.toLowerCase() === 'exercise') {
    return JSON.parse(html.innerHTML)
  } else if (html.nodeName.toLowerCase() === 'code') {
    const findBlock = /<\/[^<]*>/g
    let text = html.innerHTML
    let match = findBlock.exec(text)
    const matches = []
    while (match && match.length > 0) {
      matches.push(match[0])
      match = findBlock.exec(text)
    }
    text = matches.reduce((acc, m) => acc.replace(m, ''), text).replace(/>/g, '&gt;').replace(/</g, '&lt;')
    return {
      type: html.nodeName.toLowerCase(),
      content: [ text ],
      ...attributes
    }
  }

  if (html.childElementCount === 0) {
    return {
      type: html.nodeName.toLowerCase(),
      content: [ html.innerHTML ],
      ...attributes
    }
  }
  let content = []
  html.childNodes.forEach(element => {
    if (element.nodeName.toLowerCase() === '#text') {
      if (element.nodeValue.trim() !== '') {
        content.push(element.nodeValue)
      }
      return
    }
    const sub = htmlToJson(element)
    if ((sub.hasOwnProperty('length') && sub.length !== 0) || !sub.hasOwnProperty('length')) {
      content.push(sub)
    }
  })

  if (html.nodeName.toLowerCase() === 'p' && content[0].type === 'exercise') {
    return content[0]
  }

  if (html.nodeName.toLowerCase() === 'pre' && content[0].type === 'code') {
    return {
      type: 'codeblock',
      content: [
        {
          type: content[0].class.slice('lang-'.length),
          content: content[0].content
        }
      ]
    }
  }

  return {
    type: html.nodeName.toLowerCase(),
    content,
    ...attributes
  }
}

const copyPageFrontmatterToIndex = function () {
  const baseFolder = './_book/'
  const indexFileName = baseFolder + 'index.html'
  const indexFile = JSON.parse(fs.readFileSync(indexFileName))
  indexFile.pages.forEach((page, index) => {
    let fileName = page.url
    if (fileName.endsWith('/')) fileName += 'index.html'
    const file = JSON.parse(fs.readFileSync(baseFolder + fileName))
    indexFile.pages[index].categories = file.categories
    indexFile.pages[index].difficulty = file.difficulty
  })
  fs.writeFileSync(indexFileName, JSON.stringify(indexFile))
  console.log('Written updated index.html to disk')
}

module.exports = {
  website: {
    assets: './assets',
    js: [
      'ace/ace.js',
      'ace/theme-tomorrow.js',
      'ace/ext-language_tools.js',
      'ace/mode-solidity.js',
      'dist/bundle.js',
      'dist/0.bundle.js'
    ],
    css: [
      'exercises.css',
      'hint.css'
    ]
  },
  ebook: {
    assets: './assets',
    css: [
      'ebook.css'
    ]
  },
  hooks: {
    init: deployAssertLibrary,
    page: function (page) {
      if (page.main) {
        page.content = page.content.replace(/<p>/g, '').replace(/<\/p>/g, '')
      } else {
        const {body} = (new JSDOM(`<body>${unescape(page.content)}</body>`)).window.document
        page.content = JSON.stringify(htmlToJson(body).content, null, '\t')
        console.log('Page', page.title, 'completed')
      }
      return page
    },
    finish: copyPageFrontmatterToIndex
  },
  filters: {
    date: function (str) {
      return (new Date(str)).toDateString()
    },
    json: function (str) {
      return JSON.stringify(str)
    },
    toExcerpt: function (str, content) {
      return JSON.stringify(content)
    },
    toURL: function (path) {
      return `/${this.output.toURL(path)}`
    }
  },
  blocks: {
    exercise: {
      parse: false,
      blocks: ['title', 'hints', 'initial', 'solution', 'validation'],
      process: processDeployement
    },
    main: {
      parse: false,
      process: processMain
    }
  }
}
