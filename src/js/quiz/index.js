const request = require('request')
const crypto = require('crypto')

const url = process.env.API_URL

async function createQuiz (quiz) {
  if (url === undefined) return 0
  try {
    return new Promise((resolve, reject) => {
      request.post({
        url: `${url}/quizzes`,
        json: true,
        form: {
          hash: quiz.hash,
          pageUrl: quiz.pageUrl,
          token: process.env.API_TOKEN
        }
      }, function (error, response, data) {
        if (error) {
          reject(error)
        } else if (response.statusCode !== 200) {
          console.log('createQuiz Status', response.statusCode)
          reject(response.statusCode)
        } else {
          resolve(data.id)
        }
      })
    })
  } catch (error) {
    console.log(error)
    return 0
  }
}

function getQuiz (hash) {
  if (url === undefined) return {}

  return new Promise((resolve, reject) => {
    request.get({
      url: `${url}/quizzes/${hash}`,
      json: true
    }, function (error, response, data) {
      if (error) {
        console.log('Error:', error)
        resolve({})
      } else if (response.statusCode !== 200) {
        if (response.statusCode === 404) {
          console.log(`Status: 404. Quiz ${hash} does not yet exist.`)
        } else {
          console.log('Status:', response.statusCode)
        }
        resolve({})
      } else {
        console.log(`Quiz ${hash} has id ${data.id}`)
        resolve(data)
      }
    })
  })
}

async function saveQuiz(quiz) {
  let storedQuiz = {}
  try {
    storedQuiz = await getQuiz(quiz.hash)
  } catch (err) {
    console.log('Quiz not found in the database')
  }
  if (storedQuiz.id) {
    return storedQuiz.id
  }

  try {
    return await createQuiz(quiz)
  } catch (err) {
    return -1
  }
}

module.exports = saveQuiz
