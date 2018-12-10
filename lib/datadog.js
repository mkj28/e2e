const dogapi = require('dogapi')

class DataDog {
  constructor (dogapiInstance, namespace) {
    this._dogApi = dogapiInstance
    this._namespace = namespace

    dogapiInstance.initialize({
      api_key: process.env.DATADOG_API_KEY,
      app_key: process.env.DATADOG_APP_KEY,
    })
  }

  /**
   * Increments the namespaced metric by the specified quantity.
   * @param {string} metricName
   * @param {number | Array.<number>} quantity
   * @example
   * const datadog = new DataDog(dogapi, 'e2e')
   * datadog.sendMetric('test_failure', 3).then(console.log).catch(console.error)
   */
  sendMetric (metricName, quantity) {
    return new Promise((resolve, reject) => {
      this._dogApi.metric.send(`${this._namespace}.${metricName}`, quantity, (err, results) => {
        if (err) return reject(err)
        return resolve(results)
      })
    })
  }

  /**
   * Increments the namespaced metric by 1.
   * @param {string} metricName
   * @example
   * const datadog = new DataDog(dogapi, 'e2e')
   * datadog.incrementMetric('test_failure').then(console.log).catch(console.error)
   */
  incrementMetric (metricName) {
    return this.sendMetric(metricName, 1)
  }
}

// The singleton instance to use for all DataDog tracking:
exports.datadog = new DataDog(dogapi, 'e2e')

exports.DataDog = DataDog
