# Daikin Airbase Homey SDK v3

Local Homey SDK v3 app for a Daikin BRP15B61 Airbase wireless LAN adapter.

## Current scope

- Manual pairing
- Local HTTP polling of the Airbase adapter
- Automatic detection of the Airbase `/skyfi` API base path
- Read current power, setpoint, room temperature, mode, fan speed and zone state
- Write on/off, mode, target temperature, fan speed and zone state
- Flow cards for mode, fan speed and zones

## Setup

1. Add the device in Homey.
2. Open the device settings.
3. Enter the Airbase IP address or hostname.
4. Save settings and wait for the first poll.

## Local endpoints used

- `/common/basic_info`
- `/aircon/get_model_info`
- `/aircon/get_control_info`
- `/aircon/get_sensor_info`
- `/aircon/get_zone_setting`
- `/aircon/set_control_info`
- `/aircon/set_zone_setting`

## Notes

- The BRP15B61 on this system exposes the local API under `/skyfi`.
- Temperature writes use `stemp`; the adapter maintains the heat/cool stored setpoints internally.
- UDP auto-discovery is not implemented yet.
