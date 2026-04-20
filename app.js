'use strict';

const Homey = require('homey');

class DaikinAirbaseApp extends Homey.App {
  async onInit() {
    this.log('Daikin Airbase app initialized');
  }
}

module.exports = DaikinAirbaseApp;
