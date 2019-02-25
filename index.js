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
  const log = this.book.log

  const codes = {}

  _.each(blk.blocks, function (_blk) {
    codes[_blk.name] = _blk.body.trim()
  })

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
  }

  if (html.childElementCount === 0) {
    return {
      type: html.nodeName.toLowerCase(),
      content: html.innerHTML,
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

  return {
    type: html.nodeName.toLowerCase(),
    content,
    ...attributes
  }
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
      const { body } = (new JSDOM(`<body>${unescape(page.content)}</body>`)).window.document
      page.content = JSON.stringify(htmlToJson(body).content)
      return page
    }
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
      blocks: ['hints', 'initial', 'solution', 'validation'],
      process: processDeployement
    }
  }
}
