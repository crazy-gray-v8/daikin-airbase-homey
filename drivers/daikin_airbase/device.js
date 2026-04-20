'use strict';

const Homey = require('homey');
const { DEFAULT_PORT, DaikinAirbaseClient } = require('../../lib/daikin-airbase-client');

const DEFAULT_POLL_INTERVAL_SECONDS = 60;
const MIN_POLL_INTERVAL_SECONDS = 15;
const PICKER_DEBOUNCE_MS = 1500;
const POST_WRITE_REFRESH_DELAY_MS = 1500;
const MODE_TO_DAIKIN = {
  auto: '3',
  dry: '7',
  cool: '2',
  heat: '1',
  fan: '0',
};
const DAIKIN_TO_MODE = {
  '0': 'fan',
  '1': 'heat',
  '2': 'cool',
  '3': 'auto',
  '7': 'dry',
};
const FAN_TO_DAIKIN = {
  airside: { f_rate: '1', f_airside: '1', f_auto: '0' },
  '1': { f_rate: '1', f_airside: '0', f_auto: '0' },
  '2': { f_rate: '3', f_airside: '0', f_auto: '0' },
  '3': { f_rate: '5', f_airside: '0', f_auto: '0' },
  '1_auto': { f_rate: '1', f_airside: '0', f_auto: '1' },
  '2_auto': { f_rate: '3', f_airside: '0', f_auto: '1' },
  '3_auto': { f_rate: '5', f_airside: '0', f_auto: '1' },
};

function describeError(error) {
  if (!error) {
    return 'Unknown error';
  }

  if (error instanceof Error) {
    return error.stack || error.message || error.toString();
  }

  return String(error);
}

function parseMaybeNumber(value) {
  const normalized = Number.parseFloat(value);
  return Number.isFinite(normalized) ? normalized : null;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function interpretHomeyState(controlInfo, sensorInfo) {
  return {
    onoff: controlInfo.pow === '1',
    target_temperature: parseMaybeNumber(controlInfo.stemp),
    measure_temperature_setpoint: parseMaybeNumber(controlInfo.stemp),
    measure_temperature_current: parseMaybeNumber(sensorInfo.htemp),
    measure_temperature: parseMaybeNumber(sensorInfo.htemp),
    daikin_mode_current: DAIKIN_TO_MODE[controlInfo.mode] || 'auto',
    daikin_mode: DAIKIN_TO_MODE[controlInfo.mode] || 'auto',
    daikin_fan_speed_current: interpretFanSpeed(controlInfo),
    daikin_fan_speed: interpretFanSpeed(controlInfo),
  };
}

function interpretFanSpeed(controlInfo) {
  if (controlInfo.f_airside === '1') {
    return 'airside';
  }

  const speed = {
    '1': '1',
    '3': '2',
    '5': '3',
  }[controlInfo.f_rate];

  if (!speed) {
    return 'airside';
  }

  if (controlInfo.f_auto === '1') {
    return `${speed}_auto`;
  }

  return speed;
}

function getZoneIndexForCapability(capabilityId) {
  return {
    zone_downstairs: 0,
    zone_living: 1,
    zone_upstairs: 2,
  }[capabilityId];
}

function parseZoneSetting(zoneInfo) {
  const names = (zoneInfo.zone_name || '')
    .split(';')
    .map(name => name.trim());
  const onoff = (zoneInfo.zone_onoff || '')
    .split(';')
    .map(value => value === '1');

  return {
    names,
    onoff,
  };
}

class DaikinAirbaseDevice extends Homey.Device {
  async onInit() {
    this.pollTimeout = null;
    this.pendingPickerUpdates = new Map();
    this.isPolling = false;
    this.log(`Daikin Airbase device initialized for ${this.getName()}`);

    this.registerCapabilityListener('button_refresh_data', async () => {
      await this.poll(true);
    });

    this.registerCapabilityListener('onoff', async value => {
      await this.pushControlUpdate({ pow: value ? '1' : '0' });
    });

    this.registerCapabilityListener('target_temperature', async value => {
      await this.pushControlUpdate({ stemp: Number.parseFloat(value).toFixed(0) });
    });

    this.registerCapabilityListener('daikin_mode', async value => {
      await this.schedulePickerUpdate('daikin_mode', {
        mode: MODE_TO_DAIKIN[value] || MODE_TO_DAIKIN.auto,
      });
    });

    this.registerCapabilityListener('daikin_fan_speed', async value => {
      await this.schedulePickerUpdate('daikin_fan_speed', FAN_TO_DAIKIN[value] || FAN_TO_DAIKIN.airside);
    });

    this.registerCapabilityListener('zone_downstairs', async value => {
      await this.updateZoneState(0, value);
    });

    this.registerCapabilityListener('zone_living', async value => {
      await this.updateZoneState(1, value);
    });

    this.registerCapabilityListener('zone_upstairs', async value => {
      await this.updateZoneState(2, value);
    });

    await this.ensureState();
    this.startPolling();
  }

  async onDeleted() {
    this.clearPendingPickerUpdates();
    this.stopPolling();
  }

  async onSettings({ newSettings, changedKeys }) {
    if (changedKeys.length === 0) {
      return;
    }

    if (changedKeys.some(key => ['host', 'port', 'poll_interval'].includes(key))) {
      this.stopPolling();
      this.client = this.createClient(newSettings);
      await this.ensureState();
      this.startPolling();
    }
  }

  createClient(settings = this.getSettings()) {
    return new DaikinAirbaseClient({
      host: settings.host,
      port: Number.parseInt(settings.port, 10) || DEFAULT_PORT,
    });
  }

  getPollIntervalMs(settings = this.getSettings()) {
    const seconds = Number.parseInt(settings.poll_interval, 10);
    const safeSeconds = Number.isFinite(seconds) && seconds >= MIN_POLL_INTERVAL_SECONDS
      ? seconds
      : DEFAULT_POLL_INTERVAL_SECONDS;

    return safeSeconds * 1000;
  }

  async ensureState() {
    const settings = this.getSettings();

    if (!settings.host) {
      await this.setUnavailable(this.homey.__('device.errors.missing_host'));
      return;
    }

    this.client = this.createClient(settings);
    await this.setAvailable();
  }

  startPolling() {
    this.scheduleNextPoll(0);
  }

  stopPolling() {
    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
      this.pollTimeout = null;
    }
  }

  clearPendingPickerUpdates() {
    for (const timeout of this.pendingPickerUpdates.values()) {
      clearTimeout(timeout);
    }

    this.pendingPickerUpdates.clear();
  }

  async schedulePickerUpdate(key, partialUpdate) {
    if (this.pendingPickerUpdates.has(key)) {
      clearTimeout(this.pendingPickerUpdates.get(key));
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(async () => {
        this.pendingPickerUpdates.delete(key);

        try {
          await this.pushControlUpdate(partialUpdate);
          resolve();
        } catch (error) {
          reject(error);
        }
      }, PICKER_DEBOUNCE_MS);

      this.pendingPickerUpdates.set(key, timeout);
    });
  }

  scheduleNextPoll(delayMs = this.getPollIntervalMs()) {
    this.stopPolling();
    this.pollTimeout = setTimeout(() => {
      this.poll().catch(error => {
        this.error('Unexpected Daikin poll failure', error);
      });
    }, delayMs);
  }

  async poll(manual = false) {
    if (this.isPolling) {
      return;
    }

    const settings = this.getSettings();

    if (!settings.host) {
      await this.setUnavailable(this.homey.__('device.errors.missing_host'));
      return;
    }

    this.isPolling = true;

    try {
      const status = await this.client.getStatus();
      await this.applyStatus(status);
      await this.setStoreValue('last_poll_at', new Date().toISOString());
      await this.setAvailable();
    } catch (error) {
      const description = describeError(error);
      this.error(`Daikin poll failed for ${this.getName()}: ${description}`);
      await this.setUnavailable(description);

      if (manual) {
        throw error;
      }
    } finally {
      this.isPolling = false;
      this.scheduleNextPoll();
    }
  }

  async pushControlUpdate(partialUpdate) {
    const current = await this.client.getControlInfo();
    const payload = {
      pow: current.pow,
      mode: current.mode,
      stemp: current.stemp,
      shum: current.shum,
      f_rate: current.f_rate,
      f_dir: current.f_dir,
      ...partialUpdate,
    };

    await this.client.setControlInfo(payload);
    await delay(POST_WRITE_REFRESH_DELAY_MS);
    await this.poll(true);
  }

  async updateZoneState(index, enabled) {
    const current = await this.client.getZoneSetting();
    const parsed = parseZoneSetting(current);
    const zoneStates = parsed.onoff.slice();

    while (zoneStates.length < 8) {
      zoneStates.push(false);
    }

    zoneStates[index] = enabled;

    if (!zoneStates[0] && !zoneStates[1] && !zoneStates[2]) {
      throw new Error('At least one zone must remain enabled');
    }

    const zoneNames = parsed.names.slice();

    while (zoneNames.length < 8) {
      zoneNames.push(`Zone${zoneNames.length + 1}`);
    }

    await this.client.setZoneSetting({
      lpw: '',
      zone_name: zoneNames.join(';'),
      zone_onoff: zoneStates.map(state => (state ? '1' : '0')).join(';'),
    });

    await delay(POST_WRITE_REFRESH_DELAY_MS);
    await this.poll(true);
  }

  async setZoneCapabilityValue(capabilityId, enabled) {
    const index = getZoneIndexForCapability(capabilityId);

    if (index === undefined) {
      throw new Error(`Unknown zone capability: ${capabilityId}`);
    }

    await this.updateZoneState(index, enabled);
  }

  async isZoneCapabilityValue(capabilityId, enabled) {
    return Boolean(this.getCapabilityValue(capabilityId)) === enabled;
  }

  async setFanSpeedValue(speedId) {
    await this.schedulePickerUpdate('daikin_fan_speed', FAN_TO_DAIKIN[speedId] || FAN_TO_DAIKIN.airside);
  }

  async isFanSpeedValue(speedId) {
    return this.getCapabilityValue('daikin_fan_speed') === speedId;
  }

  async setModeValue(modeId) {
    await this.schedulePickerUpdate('daikin_mode', {
      mode: MODE_TO_DAIKIN[modeId] || MODE_TO_DAIKIN.auto,
    });
  }

  async isModeValue(modeId) {
    return this.getCapabilityValue('daikin_mode') === modeId;
  }

  async applyStatus(status) {
    const { basicInfo, modelInfo, controlInfo, sensorInfo, zoneInfo } = status;
    const interpretedState = interpretHomeyState(controlInfo, sensorInfo);
    const zones = parseZoneSetting(zoneInfo);

    if (this.hasCapability('onoff')) {
      await this.setCapabilityValue('onoff', interpretedState.onoff);
    }

    if (this.hasCapability('target_temperature') && interpretedState.target_temperature !== null) {
      await this.setCapabilityValue('target_temperature', interpretedState.target_temperature);
    }

    if (this.hasCapability('measure_temperature_setpoint') && interpretedState.measure_temperature_setpoint !== null) {
      await this.setCapabilityValue('measure_temperature_setpoint', interpretedState.measure_temperature_setpoint);
    }

    if (this.hasCapability('measure_temperature_current') && interpretedState.measure_temperature_current !== null) {
      await this.setCapabilityValue('measure_temperature_current', interpretedState.measure_temperature_current);
    }

    if (this.hasCapability('measure_temperature') && interpretedState.measure_temperature !== null) {
      await this.setCapabilityValue('measure_temperature', interpretedState.measure_temperature);
    }

    if (this.hasCapability('daikin_fan_speed')) {
      await this.setCapabilityValue('daikin_fan_speed', interpretedState.daikin_fan_speed);
    }

    if (this.hasCapability('daikin_fan_speed_current')) {
      await this.setCapabilityValue('daikin_fan_speed_current', interpretedState.daikin_fan_speed_current);
    }

    if (this.hasCapability('daikin_mode')) {
      await this.setCapabilityValue('daikin_mode', interpretedState.daikin_mode);
    }

    if (this.hasCapability('daikin_mode_current')) {
      await this.setCapabilityValue('daikin_mode_current', interpretedState.daikin_mode_current);
    }

    if (this.hasCapability('zone_downstairs')) {
      await this.setCapabilityValue('zone_downstairs', Boolean(zones.onoff[0]));
    }

    if (this.hasCapability('zone_living')) {
      await this.setCapabilityValue('zone_living', Boolean(zones.onoff[1]));
    }

    if (this.hasCapability('zone_upstairs')) {
      await this.setCapabilityValue('zone_upstairs', Boolean(zones.onoff[2]));
    }

    if (basicInfo.name) {
      await this.setStoreValue('adapter_name', basicInfo.name);
    }

    if (basicInfo.mac) {
      await this.setStoreValue('adapter_mac', basicInfo.mac);
    }

    if (modelInfo.model) {
      await this.setStoreValue('model', modelInfo.model);
    }
  }
}

module.exports = DaikinAirbaseDevice;
