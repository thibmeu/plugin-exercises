const request = require('request')
const sha256 = require('../utils/hash')
const url = process.env.API_URL

function getExercise (solution) {
  if (url === undefined) {
    return {}
  }
  return new Promise((resolve, reject) => {
    const hash = sha256(solution)
    request.get({
      url: `${url}/exercises/${hash}`,
      json: true
    }, function (error, response, data) {
      if (error) {
        console.log('Error:', error)
        resolve({})
      } else if (response.statusCode !== 200) {
        if (response.statusCode === 404) {
          console.log(`Status: 404. Exercise ${hash} does not yet exist.`)
        } else {
          console.log('Status:', response.statusCode)
        }
        resolve({})
      } else {
        console.log(`Exercise ${hash} has id ${data.id}`)
        resolve(data)
      }
    })
  })
}

function createExercise (exercise) {
  return new Promise((resolve, reject) => {
    request.post({
      url: `${url}/exercises`,
      json: true,
      form: {
        hash: exercise.hash,
        addresses: JSON.stringify(exercise.addresses),
        abi: JSON.stringify(exercise.abi),
        title: exercise.title,
        pageUrl: exercise.pageUrl,
        token: process.env.API_TOKEN
      }
    }, function (error, response, data) {
      if (error) {
        reject(error)
      } else if (response.statusCode !== 200) {
        console.log('createExercise Status', response.statusCode)
        reject(response.statusCode)
      } else {
        console.log(`Exercise ${exercise.hash} saved with id ${data.id}`)
        resolve(data.id)
      }
    })
  })
}

async function registerExercise (exercise) {
  if (url === undefined) return 0
  try {
    return createExercise(exercise)
  } catch (error) {
    console.log(error)
    return 0
  }
}

module.exports = {
  getExercise: getExercise,
  registerExercise: registerExercise
}
