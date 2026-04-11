# ***WIP!*** Daikin Airbase Homey SDK v3 ***WIP!***

Local Homey SDK v3 app for a Daikin BRP15B61 Airbase wireless LAN adapter.

## Current scope

- Manual pairing
- Local HTTP polling of the Airbase adapter
- Read current power, mode, target temperature, room temperature and humidity
- Write on/off, mode, target temperature and fan speed

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
- `/aircon/set_control_info`

## Notes

- This version assumes the BRP15B61 exposes the older BRP069-style local API.
- Zone control and UDP auto-discovery are planned follow-up steps.
