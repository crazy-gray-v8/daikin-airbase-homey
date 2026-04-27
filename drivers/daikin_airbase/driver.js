'use strict';

const Homey = require('homey');
const crypto = require('crypto');
const { DEFAULT_PORT } = require('../../lib/daikin-airbase-client');

class DaikinAirbaseDriver extends Homey.Driver {
  async onInit() {
    this.log('Daikin Airbase driver initialized');
    this.registerFlowCards();
  }

  registerFlowCards() {
    this.homey.flow.getActionCard('set_zone_state')
      .registerRunListener(async args => {
        await args.device.setZoneCapabilityValue(this.normalizeDropdownValue(args.zone), this.normalizeDropdownValue(args.state) === 'on');
        return true;
      });

    this.homey.flow.getConditionCard('zone_state_is')
      .registerRunListener(async args => args.device.isZoneCapabilityValue(
        this.normalizeDropdownValue(args.zone),
        this.normalizeDropdownValue(args.state) === 'on',
      ));

    this.homey.flow.getActionCard('set_fan_speed_value')
      .registerRunListener(async args => {
        await args.device.setFanSpeedValue(this.normalizeDropdownValue(args.speed));
        return true;
      });

    this.homey.flow.getConditionCard('fan_speed_is')
      .registerRunListener(async args => args.device.isFanSpeedValue(this.normalizeDropdownValue(args.speed)));

    this.homey.flow.getActionCard('set_mode_value')
      .registerRunListener(async args => {
        await args.device.setModeValue(this.normalizeDropdownValue(args.mode));
        return true;
      });

    this.homey.flow.getConditionCard('mode_is')
      .registerRunListener(async args => args.device.isModeValue(this.normalizeDropdownValue(args.mode)));

    this.homey.flow.getActionCard('refresh_device_data')
      .registerRunListener(async args => {
        await args.device.refreshCurrentData();
        return true;
      });
  }

  normalizeDropdownValue(value) {
    if (typeof value === 'string') {
      return value;
    }

    if (value && typeof value === 'object' && typeof value.id === 'string') {
      return value.id;
    }

    return undefined;
  }

  async onPair(session) {
    this.log('Daikin Airbase pairing session started');

    session.setHandler('list_devices', async () => {
      return [
        {
          name: this.homey.__('pair.default_device_name'),
          data: {
            id: crypto.randomUUID(),
          },
          settings: {
            host: '',
            port: DEFAULT_PORT,
            poll_interval: 60,
          },
          store: {
            created_at: new Date().toISOString(),
          },
        },
      ];
    });
  }
}

module.exports = DaikinAirbaseDriver;
