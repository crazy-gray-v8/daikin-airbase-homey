'use strict';

const http = require('http');
const { URL, URLSearchParams } = require('url');

const DEFAULT_PORT = 80;
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_BASE_PATH_CANDIDATES = ['/skyfi', ''];

function parseDaikinResponse(body) {
  const parsed = {};
  const normalizedBody = body.trim();

  for (const segment of normalizedBody.split(',')) {
    const separatorIndex = segment.indexOf('=');

    if (separatorIndex === -1) {
      continue;
    }

    const key = segment.slice(0, separatorIndex).trim();
    const rawValue = segment.slice(separatorIndex + 1).trim();

    try {
      parsed[key] = decodeURIComponent(rawValue);
    } catch (error) {
      parsed[key] = rawValue;
    }
  }

  if (!parsed.ret) {
    throw new Error(`Unexpected Daikin response: ${normalizedBody}`);
  }

  if (parsed.ret !== 'OK') {
    throw new Error(parsed.ret);
  }

  return parsed;
}

class DaikinAirbaseClient {
  constructor({
    host,
    port = DEFAULT_PORT,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  }) {
    this.host = host;
    this.port = port;
    this.timeoutMs = timeoutMs;
    this.basePath = null;
  }

  async rawRequest(path, params = null) {
    if (!this.host) {
      throw new Error('Missing Daikin Airbase host');
    }

    const url = new URL(`http://${this.host}:${this.port}${path}`);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null || value === '') {
          continue;
        }

        url.searchParams.append(key, String(value));
      }
    }

    return new Promise((resolve, reject) => {
      const req = http.get(url, res => {
        let body = '';

        res.on('data', chunk => {
          body += chunk.toString();
        });

        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Daikin HTTP ${res.statusCode}`));
            return;
          }

          try {
            resolve(parseDaikinResponse(body));
          } catch (error) {
            reject(error);
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(this.timeoutMs, () => {
        req.destroy(new Error(`Daikin request timed out after ${this.timeoutMs}ms`));
      });
    });
  }

  normalizeBasePath(basePath) {
    if (!basePath) {
      return '';
    }

    return basePath.startsWith('/') ? basePath : `/${basePath}`;
  }

  async detectBasePath() {
    if (this.basePath !== null) {
      return this.basePath;
    }

    for (const candidate of DEFAULT_BASE_PATH_CANDIDATES) {
      try {
        await this.rawRequest(`${candidate}/common/basic_info`);
        this.basePath = candidate;
        return this.basePath;
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes('404')) {
          throw error;
        }
      }
    }

    throw new Error('Unable to detect Daikin API base path');
  }

  async request(path, params = null) {
    const basePath = await this.detectBasePath();
    return this.rawRequest(`${this.normalizeBasePath(basePath)}${path}`, params);
  }

  async getBasicInfo() {
    return this.request('/common/basic_info');
  }

  async getModelInfo() {
    return this.request('/aircon/get_model_info');
  }

  async getControlInfo() {
    return this.request('/aircon/get_control_info');
  }

  async getSensorInfo() {
    return this.request('/aircon/get_sensor_info');
  }

  async getZoneSetting() {
    return this.request('/aircon/get_zone_setting');
  }

  async setControlInfo(params) {
    return this.request('/aircon/set_control_info', params);
  }

  async setZoneSetting(params) {
    return this.request('/aircon/set_zone_setting', params);
  }

  async getStatus() {
    const [basicInfo, modelInfo, controlInfo, sensorInfo, zoneInfo] = await Promise.all([
      this.getBasicInfo(),
      this.getModelInfo(),
      this.getControlInfo(),
      this.getSensorInfo(),
      this.getZoneSetting(),
    ]);

    return {
      basicInfo,
      modelInfo,
      controlInfo,
      sensorInfo,
      zoneInfo,
    };
  }
}

module.exports = {
  DEFAULT_BASE_PATH_CANDIDATES,
  DEFAULT_PORT,
  DEFAULT_TIMEOUT_MS,
  DaikinAirbaseClient,
};
