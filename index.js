const _ = require('lodash')
const fs = require('fs')
const path = require('path')
const deployExercises = require('./src/js/exercise/index')
const blockchain = require('./src/js/exercise/blockchain')
const unescape = require('unescape')
const { JSDOM } = require('jsdom')
const solc = require('solc')

const WEBSITE_TPL = _.template(fs.readFileSync(path.resolve(__dirname, './assets/website.html')))
const EBOOK_TPL = _.template(fs.readFileSync(path.resolve(__dirname, './assets/ebook.html')))
const QUESTION_TPL = _.template(fs.readFileSync(path.resolve(__dirname, './assets/mcq.html')))
const ANSWER_TPL = _.template(fs.readFileSync(path.resolve(__dirname, './assets/mcq-answer.html')))
const QUIZ_TPL = _.template(fs.readFileSync(path.resolve(__dirname, './assets/quiz.html')))
const HTML_TPL = _.template(fs.readFileSync(path.resolve(__dirname, './assets/html.html')))

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
  const codes = solc.compile({ sources: input }, 1)
  this.config.values.variables.assertLibrary = await blockchain.deploy(codes.contracts['Assert.sol:Assert'])
}

async function processHtml (blk) {
  const content = encodeURIComponent(blk.body.trim())
  return HTML_TPL({ content })
}

async function processQuiz (blk) {
  const codes = { questions: [] }
  let currentQuestion = {}
  const that = this
  if (blk.blocks) {
    for (const _blk of blk.blocks) {
      if (_blk.name === 'mcq') {
        currentQuestion = { 'body': _blk.body, 'blocks': [] }
      } else if (_blk.name === 'answers') {
        currentQuestion['blocks'].push({ name: 'answers', body: _blk.body })
      } else if (_blk.name === 'hints') {
        currentQuestion['blocks'].push({ name: 'hints', body: _blk.body })
      } else if (_blk.name === 'endmcq') {
        const processedQuestion = await processQuestion(currentQuestion, that)
        const { body: questionBody } = (new JSDOM(`<body>${unescape(processedQuestion)}</body>`)).window.document
        codes.questions.push(htmlToJson(questionBody).content[0])
      } else {
        console.log('unexpected block', _blk.name)
      }
    }
  }
  return QUIZ_TPL({ codes })
}

async function processQuestion (blk, that = null) {
  const codes = {}
  _.each(blk.blocks, function (_blk) {
    codes[_blk.name] = _blk.body.trim()
  })

  let bookElement = that ? that.book : this.book

  if (codes.hints === undefined) {
    codes.hints = ''
  } else {
    codes.hints = await bookElement.renderBlock('markdown', codes.hints)
    codes.hints = renderJSON(codes.hints)
  }

  let isMultipleChoice = true
  if (codes.answers) {
    codes.answersParsed = []
    const answerLines = codes.answers.split('\n')
    answerLines.forEach(async line => {
      line = line.trim()
      if (line !== '' && startsWithCheckOrRadiobox(line)) {
        const correctAnswer = isCorrectAnswer(line)
        if (isRadioboxAnswer(line)) isMultipleChoice = false

        let answerText = await bookElement.renderBlock('markdown', line.substring(3).trim())
        answerText = renderJSON(answerText)
        const answerParsed = JSON.parse(ANSWER_TPL({ answer: answerText, isCorrectAnswer: correctAnswer }))
        codes.answersParsed.push(answerParsed)
      }
    })
  }
  codes.isMultipleChoice = isMultipleChoice
  const renderedBody = await bookElement.renderBlock('markdown', blk.body)
  codes.question = renderJSON(renderedBody)
  codes.question = typeof codes.question === 'string' ? JSON.stringify(codes.question) : codes.question.map(JSON.stringify)
  return QUESTION_TPL({ codes })
}

function startsWithCheckOrRadiobox (line) {
  if (line) {
    const lineLower = line.toLowerCase()
    if (lineLower.startsWith('[ ]') || lineLower.startsWith('[x]') ||
      lineLower.startsWith('( )') || lineLower.startsWith('(x)')) {
      return true
    }
  }
  return false
}

const isRadioboxAnswer = (line) => {
  return line.toLowerCase().startsWith('(x)') || line.toLowerCase().startsWith('( )')
}

const isCorrectAnswer = (line) => {
  return line.toLowerCase().startsWith('[x]') || line.toLowerCase().startsWith('(x)')
}

function renderJSON (content) {
  content = content.replace('<p>', '').replace('</p>', '').replace('\n', '')
  const { body } = (new JSDOM(`<body>${content}</body>`)).window.document
  return htmlToJson(body).content
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

  codes.pageUrl = pathToURL(this.ctx.ctx.file.path)

  // To have a quick update on local machine deployment can be disabled
  if (!isWriteMode()) {
    // Compile and deploy test contracts to our blockchain
    codes.deployed = await deployExercises(codes, { address: this.config.values.variables.assertLibrary, source: assertLibrary })
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

  const listParseInnerHtml = ['exercise', 'mcq', 'quiz', 'htmlblock']

  if (listParseInnerHtml.includes(html.nodeName.toLowerCase())) {
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
      content: [text],
      ...attributes
    }
  }

  if (html.childElementCount === 0) {
    return {
      type: html.nodeName.toLowerCase(),
      content: [html.innerHTML],
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

  const listNestedContentBlocks = ['exercise', 'mcq', 'quiz', 'html']
  if (html.nodeName.toLowerCase() === 'p' && listNestedContentBlocks.includes(content[0].type)) {
    return content[0]
  }

  if (html.nodeName.toLowerCase() === 'pre' && content[0].type === 'code') {
    return {
      type: 'codeblock',
      content: [
        {
          type: content[0].class ? content[0].class.slice('lang-'.length) : 'text',
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
    indexFile.pages[index].categories = file.categories || []
    indexFile.pages[index].difficulty = file.difficulty || null
    indexFile.pages[index].author = file.author || null
    indexFile.pages[index].time = file.time || null
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
      'exercises.css'
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
        const { body } = (new JSDOM(`<body>${unescape(page.content)}</body>`)).window.document
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
    mcq: {
      parse: false,
      blocks: ['hints', 'answers'],
      process: processQuestion
    },
    quiz: {
      parse: false,
      blocks: ['mcq', 'hints', 'answers', 'endmcq'],
      process: processQuiz
    },
    html: {
      parse: false,
      process: processHtml
    },
    main: {
      parse: false,
      process: processMain
    }
  }
}
