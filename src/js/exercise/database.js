const request = require('request')
const crypto = require('crypto')

const url = process.env.API_URL

// eslint-disable-next-line no-unused-vars
function getExercise (solution) {
  if (url === undefined) {
    return {}
  }
  const hash = crypto.createHash('sha256').update(solution).digest('hex')

  return new Promise((resolve, reject) => {
    request.get({
      url: `${url}/exercises/${hash}`,
      json: true
    }, function (error, response, data) {
      if (error) {
        console.log('Error:', error)
        resolve({})
      } else if (response.statusCode !== 200) {
        if (response.statusCode === 404) console.log('Status: 404. Exercise does not yet exist.')
        else console.log('Status:', response.statusCode)
        resolve({})
      } else {
        console.log(`Exercise ${hash} has id ${data.id}`)
        resolve(data)
      }
    })
  })
}

function createExercise (title, hash, addresses, abi) {
  return new Promise((resolve, reject) => {
    request.post({
      url: `${url}/exercises`,
      json: true,
      form: {
        hash: hash,
        addresses: JSON.stringify(addresses),
        abi: JSON.stringify(abi),
        title: title,
        token: process.env.API_TOKEN
      }
    }, function (error, response, data) {
      if (error) {
        reject(error)
      } else if (response.statusCode !== 200) {
        console.log('createExercise Status', response.statusCode)
        reject(response.statusCode)
      } else {
        resolve(data.id)
      }
    })
  })
}

async function register (title, solution, addresses, abi) {
  if (url === undefined) {
    return 0
  }
  // Hash of the solution serves as a unique identifier of the exercise
  const hash = crypto.createHash('sha256').update(solution).digest('hex')

  // Put the exercise into the database
  try {
    return createExercise(title, hash, addresses, abi)
  } catch (error) {
    console.log(error)
    return 0
  }
}

module.exports = {
  getExercise: getExercise,
  register: register
}
