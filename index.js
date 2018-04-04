var _ = require('lodash');
var fs = require('fs');
var path = require('path');
var solc = require('solc');
var linker = require('solc/linker');
var Web3 = require('web3');

var web3 = new Web3('http://localhost:7545');

// Will be in the CI and so never revealed
var PRIVATE_KEY = '';
web3.eth.accounts.wallet.add(PRIVATE_KEY);

var WEBSITE_TPL = _.template(fs.readFileSync(path.resolve(__dirname, "./assets/website.html")));
var EBOOK_TPL = _.template(fs.readFileSync(path.resolve(__dirname, "./assets/ebook.html")));


// Should go in its own npm package
var parseSolidityJSON = function(name, interfaceStr) {
    var interface = JSON.parse(interfaceStr);

    var interfaceTxt = 'pragma solidity ^0.4.21;\ninterface ' + name + ' {\n';

    interfaceTxt += interface.map(function(obj) {
        var result = '    ';
        result += obj.type;
        result += ' ' + obj.name;
        result += '(' + obj.inputs.map(function(input) {
            return input.type + ' ' + input.name
        }).join(', ') + ')';
        result += ' ' + 'external';
        result += ' ' + obj.stateMutability;
        if (obj.payable) {
            result += ' ' + 'payable';
        }
        if (obj.outputs) {
            result += ' returns (' + obj.outputs.map(function (output) {
                return output.type
            }).join(', ') + ')';
        }
        return result + ';';
    }).join('\n');

    interfaceTxt += '\n}';
    return interfaceTxt;
};

function deploy(contract) {
    var abi = contract.interface;
    var bc = '0x' + contract.bytecode; // web3 expect bytecode to be written in hexadecimal

    var mContract = new web3.eth.Contract(JSON.parse(abi));

    return new Promise(function(resolve) {
        mContract.deploy({
            data: bc,
            arguments: []
        }).estimateGas({
            from: web3.eth.accounts.wallet[0].address
        }).then(function(gasAmount) {
            return mContract.deploy({
                data: bc,
                arguments: []
            }).send({
                from: web3.eth.accounts.wallet[0].address,
                gas: gasAmount
            })
        }).then(function(dContract){
            resolve(dContract.options.address);
        });
    });
}

var compileAndDeploy = async function(codes, book) {
    // Compile the solution
    var cSolution = solc.compile({ sources: { 'solution.sol': codes['solution'] } }, 1);

    // Create an interface for every contract the user will code
    var interfaces = Object.keys(cSolution.contracts).map(function(fullname) {
        var name = (new RegExp('([^:]+)$')).exec(fullname)[0].trim();
        return {
            name: name,
            code: parseSolidityJSON(name, cSolution.contracts[fullname].interface)
        };
    });

    // Compile interfaces, assert library and test code
    var input = _.reduce(interfaces, function(acc, interface) {
        var m = {};
        m[interface.name + '.sol'] = interface.code;
        return _.extend(acc, m);
    }, {});
    input['Assert.sol'] = fs.readFileSync(book.resolve('sol/Assert.sol'), 'utf8');
    input['test.sol'] = codes['validation'];

    var cTests = solc.compile({ sources: input }, 1);

    // Deployment
    // First deploy assert library
    var assertAddress = await deploy(cTests.contracts['Assert.sol:Assert']);

    // Link assert library to all tests

    // Remaining contracts to deploy (i.e. tests)
    var toDeploy = Object.keys(cTests.contracts)
        .filter(function(key) {
            return !key.startsWith('Assert.sol')
        });

    // It should be possible to deploy contracts asynchronously but I can't make it work
    var tests = [];
    for (var index = 0; index < toDeploy.length; index++) {
        var key = toDeploy[index];
        // Link test with the already deployed assert library
        cTests.contracts[key].bytecode =
            linker.linkBytecode(
                cTests.contracts[key].bytecode,
                { 'Assert.sol:Assert': assertAddress }
            );
        // Deploy the test
        var address = await deploy(cTests.contracts[key]);
        tests.push({
            address: address,
            abi: cTests.contracts[key].interface
        })
    }

    return tests;
}

module.exports = {
    website: {
        assets: "./assets",
        js: [
            "ace/ace.js",
            "ace/theme-tomorrow.js",
            "ace/mode-javascript.js",
            "exercises.js"
        ],
        css: [
            "exercises.css"
        ],
        sol: [
            "sol/Assert.sol"
        ]
    },
    ebook: {
        assets: "./assets",
        css: [
            "ebook.css"
        ]
    },
    blocks: {
        exercise: {
            parse: false,
            blocks: ["initial", "solution", "validation", "context"],
            process: async function(blk) {
                var codes = {};

                _.each(blk.blocks, function(_blk) {
                    codes[_blk.name] = _blk.body.trim();
                });

                // Compile and deploy test contracts to our blockchain
                var tests = await compileAndDeploy(codes, this.book);
                console.log(tests);

                // Select appropriate template
                var tpl = (this.generator === 'website' ? WEBSITE_TPL : EBOOK_TPL);

                return tpl({
                    message: blk.body,
                    codes: codes,
                    tests: tests
                });
            }
        }
    }
};
