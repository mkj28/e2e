
const debug = require('debug')('dsc-e2e:lib:run-tests')
const EventEmitter = require('events')
const pAll = require('p-all')

const { createSauceName } = require('./saucelabs')
const RunTestWithRetry = require('./run-test-with-retry')
const {
  lookupBrowser,
  validateTestContext,
} = require('./validate')
const constants = require('./constants')
const {
  concat,
  unwind,
} = require('./utils')
const env = require('./env')

module.exports = class RunTests {
  constructor (tests, _options) {
    this.eventsEmitter = new EventEmitter()
    this.tests = tests
    this._options = _options || {}
    this.env = env

    const options = this.options = {}

    options.browsers = (_options.browsers || []).map(lookupBrowser)
    options.ignoreBrowsers = (_options.ignoreBrowsers || []).map(lookupBrowser)
    // do not run sauce labs test by default
    options.sauce = !env.DISABLE_SAUCELABS && (_options.sauce === true || _options.sauceConcurrency)
    // run local tests by default
    options.local = _options.local !== false
    // do not run headless by default
    // headless tests can only be run locally
    // if set, will run browsers in headless mode
    options.headless = options.local && (_options.headless === true || env.headless)

    options.createSauceName = _options.createSauceName || createSauceName

    // concurrencies
    options.concurrency = Math.max(_options.concurrency || env.concurrency, 1)
    options.localConcurrency = Math.max(_options.localConcurrency || env.localConcurrency, 0)
    options.sauceConcurrency = Math.max(_options.sauceConcurrency || env.sauceConcurrency, 0)

    // whether to stream all console output
    options.stream = options.concurrency === 1 &&
      options.localConcurrency < 1 &&
      options.sauceConcurrency < 1

    // array of all the test functions
    this.runners = []
    this.allTestFns = []
    this.localTestFns = []
    this.sauceTestFns = []
  }

  // split execution between setting up tests and running them
  // the reason is that if you want to hook into this,
  // you'd run `runTests()` yourself after messing with the tests
  exec () {
    this.setupTests()
    return this.runTests()
  }

  // actually run the tests
  async runTests () {
    const { options } = this
    if (options.stream || options.concurrency > 1) {
      // run test 1 by 1 and stream to stdout
      return pAll(this.allTestFns, {
        concurrency: Math.max(options.concurrency, 1),
      })
    }

    // run tests with concurrency and print logs to stdout in batches
    const results = await Promise.all([
      pAll(this.localTestFns, {
        concurrency: Math.max(options.localConcurrency, 1),
      }),
      pAll(this.sauceTestFns, {
        concurrency: Math.max(options.sauceConcurrency, 1),
      }),
    ])
    return results.reduce(concat, [])
  }

  // returns all combinations of tests based on .options
  getUnwoundTests (tests) {
    return tests
      .map((test) => {
        // set defaults on the test object
        const options = Object.assign({}, constants.TEST_OPTIONS_DEFAULTS, test.options || {})
        options.clients = options.clients.map((_client) => {
          const client = Object.assign({}, constants.TEST_OPTIONS_CLIENT_DEFAULTS, _client)
          client.browser = lookupBrowser(client.browser || 'chrome')
          client.platform = Object.assign({}, constants.TEST_OPTIONS_CLIENT_PLATFORM_DEFAULTS, client.platform || {})
          return client
        }).filter(client => this.filterClient(client, Object.assign({}, test, { options })))
        return Object.assign({}, test, { options })
      })
      // unwind test options
      .map((test) => unwind(test.options, {
        clients: 'client',
      }).map(options => Object.assign({}, test, { options })))
      // reduce neested arrays
      .reduce(concat, [])
  }

  // returns all the test contexts
  getTestContexts () {
    const { options } = this
    return this.getUnwoundTests(this.tests).map((test) => (
      (Array.isArray(test.parameters) ? test.parameters : [test.parameters]).map((parameters) => {
        const mode = this.getTestMode(test.options.client)
        const context = {
          test,
          runnerOptions: options,
          env,
          parameters,
          mode,
        }

        validateTestContext(context)

        return context
      })
    )).reduce((a, b) => a.concat(b), [])
  }

  // for each test, sets up the parallelism and the runners
  setupTests () {
    const {
      runners,
      allTestFns,
      localTestFns,
      sauceTestFns,
    } = this

    this.getTestContexts().forEach((context) => {
      const runner = new RunTestWithRetry(context, this.eventsEmitter)
      runners.push(runner)

      const testArray = context.mode === 'sauce' ? sauceTestFns : localTestFns

      testArray.push(testFn)
      allTestFns.push(testFn)

      async function testFn () {
        debug('starting %s', context.test.id)
        const result = await runner.exec()
        debug('finished %s', context.test.id)
        return result
      }
    })
  }

  // removes clients that cannot be run based on the current runner args
  filterClient (client, test) {
    const { options } = this

    // filter tests by browser
    if (options.browsers.length && !options.browsers.some(browser => client.browser.name === browser.name)) return false

    // ignore specific browsers
    if (options.ignoreBrowsers.some(browser => browser.name === client.browser.name)) return false

    if (options.headless && client.browser.headless) return true
    if (options.local && client.browser.local) return true
    if (test.options.driver === 'puppeteer') return false // cannot run in saucelabs
    if (options.sauce && client.browser.sauce) return true
    return false
  }

  // based on what parameters you're running tests with
  // and what the client supports, decides which type of test to run
  getTestMode (client) {
    const { options } = this
    if (options.headless && client.browser.headless) return 'headless'
    if (options.local && client.browser.local) return 'local'
    if (options.sauce && client.browser.sauce) return 'sauce'
    throw new Error(`Unknown test location for client: ${client}`)
  }
}
