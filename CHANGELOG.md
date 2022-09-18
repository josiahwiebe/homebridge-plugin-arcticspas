# Change Log

All notable changes to this project will be documented in this file.

## 2.2.6 (07.03.2022)
- Improved mechanism to force spa to restart sending status messages.

## 2.2.5 (04.03.2022)
- If the spa stops sending status messages, proactively try to connect

## 2.2.4 (30.01.2022)
- Minor improvement to logging
- Improved documentation, covering automation

## 2.2.3 (14.06.2021)
- Merge branch resolving security issue in a dependency (normalize-url)

## 2.2.2 (30.05.2021)
- Merge branch resolving security issue in a dependency (ws)
- Better logging

## 2.2.1 (17.05.2021)
- Better logging of the recording/playback of settings changes when spa is disconnected and then
  re-connected.

## 2.2.0 (14.05.2021)
- Given unreliability of Balboa-wifi module, keep track of some settings made while we are
  temporarily disconnected, and apply them when the connection is re-established

## 2.1.5 (10.05.2021)
- Small fix to prevent Home thinking the circulation pump has been turned off when it has not

## 2.1.4 (10.05.2021)
- Addition of circulation pump, for those spas which have one. This accessory is read-only.
- Logging of temperature history for the last 24 hours, once per day. Inspect the homebridge log
  if you wish to analyse this data and perhaps use some of it for automation purposes.

## 2.1.3 (06.05.2021)
- Update of plugin dependencies
- Auto-adjust the Spa's clock if it is meaningfully different to the time known by this plugin
  (most usefully this will typically auto-adjust for daylight savings)

## 2.1.2 (11.12.2020)
- Better handling of water flow problems.

## 2.1.1 (11.12.2020)
- Fix to alerting when water flow is low/failed

## 2.1.0 (21.09.2020)
- Add ability to toggle between 'ready' and 'rest' heating mode, with a new switch accessory type

## 2.0.22 (18.09.2020)
- Small clean up to message handling
- Clean up to temperature conversion code, resulting in slightly clearer logging

## 2.0.21 (11.09.2020)
- Put back in the message checksum validation that was omitted in the last couple of releases
- Cleaner code for low-level handling of messages from the spa
- Handle merging spa messages that are split across two chunks in the socket

## 2.0.20 (08.09.2020)
- Fix to logging problem

## 2.0.19 (08.09.2020)
- Handle, and safely ignore, a response after the user manually sets the spa time,
  and other similar "preference responses"

## 2.0.18 (08.09.2020)
- Improved handling of low-level spa data over the socket, opportunity revealed by logging
  improvements in the previous release. Enables multiple messages sent in a single packet to be interpreted correctly. Likely more improvements still needed

## 2.0.17 (08.09.2020)
- Added some heater-problem error codes to the ones that are alerted by the 'leak sensor'
- Better handling or at least logging of problems with checksum and message lengths from the spa

## 2.0.16 (19.08.2020)
- Merged branch to support HOOBS (thank you!)

## 2.0.15 (12.08.2020)
- Add count of days uptime, so we can assess wifi module reliability

## 2.0.14 (12.08.2020)
- Keep count of reconnections in log, so we can assess wifi module reliability

## 2.0.13 (12.08.2020)
- Improve logging corner case over multiple spa reconnections

## 2.0.12 (04.08.2020)
- Better default naming of the two locks

## 2.0.11 (04.08.2020)
- Better dev mode logging

## 2.0.10 (04.08.2020)
- Fix to some logging issues with Fahrenheit
- Added two new Lock accessories: to lock/unlock the spa settings and to lock/unlock the full spa
  control panel.
  (thanks to https://github.com/ccutrer/balboa_worldwide_app/wiki#toggle-test-setting-request for the mechanism for this)

## 2.0.9 (15.07.2020)
- Improved logging
- Updated dependencies (fixing an 'npm audit' low severity problem)

## 2.0.8 (04.07.2020)
- Check whether the Spa has continued to broadcast state updates and report an error if not

## 2.0.7 (02.07.2020)
- Fixes for when Spa is set to operate in Fahrenheit

## 2.0.6 (16.06.2020)
- Better discovery logging
- The spa 'name' config, which is largely cosmetic, now has a default. This means under most
  circumstances all configuration is automatic.
- Updated Readme

## 2.0.5 (16.06.2020)
- Minor cleanup
- Improved documentation

## 2.0.4 (16.06.2020)
- Improved spa discovery with retries if the spa can't initially be found
- Nicer UI for spa configuration
- Improved Readme documentation, including a new getting started section with screenshots

## 2.0.3 (15.06.2020)
- Fix to typo in checking host length

## 2.0.2 (15.06.2020)
- Use UDP discovery to find your Spa's IP address automatically on your local network. This means 
  the IP address in the configuration settings is now optional
- Improved some areas which assumed the spa was currently connected (they generally disconnect
  spontaneously from time to time)
- Allow automatic creation of all spa controls in homebridge, and use that as the default
  behaviour. Still allow falling-back to manually created controls if desired by the user.
- Removed 'model' from config. The plugin simply uses the name you give your spa for that purpose.
- Together all of the above means the default 'config' for this plugin only requires you to give your
  Spa a name.
  
## 2.0.1 (03.06.2020)
- Logging and documentation improvements

## 2.0.0 (03.06.2020)
- Overhaul of automated spa configuration usage, so that there is no longer a need to
  declare the number of speeds of each pump, etc, in the config.
- Added support for all remaining known Spa devices: "blower", "mister", "aux1", "aux2" (please test!).
- Various cleanup
- Corrected corner-case of trying to turn a pump off when that is not possible (e.g. due
  to the filter schedule)

## 1.9.18 (29.05.2020)
- Fix for using Siri to adjust speed of a multi-speed pump, where the on/setRotationSpeed calls are
  made in reverse order.

## 1.9.17 (28.05.2020)
- Added fault code M037 for 'hold mode activated'
- Logic to deal with situation during filtering when a pump cannot be turned off, which
  specifically leads to a bad user experience when trying to switch the pump from High to 
  Low speed, when it can actually just end up back in High speed each time.

## 1.9.16 (27.05.2020)
- Capture the panel & settings "lock" status of the spa, and the "hold" status.
- Add ability to create a homekit switch to control the hold status.

## 1.9.15 (27.05.2020)
- Optional model name in config, which propagates through to all accessories in Home
- Added capture and logging of the filtering status of the spa

## 1.9.14 (26.05.2020)
- Cleanup

## 1.9.13 (25.05.2020)
- Fixes to pump speed setting problem introduced in 1.9.10
- Better connection dropping handling, hopefully.

## 1.9.10 (25.05.2020)
- When connection to Spa drops for a while, signal an error state to Homekit so that the
  user is aware, and their actions of course take no effect.
- Improved logging to align with the above change
  
## 1.9.9 (24.05.2020)
- Minor code and documentation improvements
- Improved logging for the fault reporting.
- Deal with pump on/speed setting simultaneity to deal with some conditions
  where synchronisation can fail.
- Similarly, allow some synchronisation leeway when we believe the physical
  state has changed outside of Homekit.
- Fix to settings pumps directly from High to Low (a coding error instead set
  the pump to off in this situation).

## 1.9.8 (22.05.2020)
- Some improvements to the fault reporting, with better messages in the log
- Improved documentation

## 1.9.7 (22.05.2020)
- First version that will monitor manual spa state/control changes and tell HomeKit about them.
- This means 'digital' and 'manual' state of all the Spa controls should be fully in sync.

## 1.9.6 (21.05.2020)
- When Spa temperature is unknown/undefined (during priming), report 'null' to Homekit which seems to be ignored by Homekit, which just reports the previously known value = better user experience.
- Beginnings of infrastructure to have Homekit update to be in sync when manual spa controls are used

## 1.9.5 (20.05.2020)
- Only read the Spa control types configuration once, rather than each time a socket error/reconnection happens
- Use 'info' logging for socket error+reconnection for greater visibility of potential problems

## 1.9.4 (19.05.2020)
- Some interpretation of the additional control panel requests (e.g. to get the motherboard model)
- Some code cleanup
- Only use same-day spa faults to trigger the water flow sensor state (previously also day before used)

## 1.9.3 (19.05.2020)
- Clean up to some spa messages, and added control panel requests 1-4 to gain more information

## 1.9.2 (19.05.2020)
- Code cleanup and documentation
- Verified By Homebridge
- Changed some defaults to placeholders in the config schema
- Added link to readme so that you can report/validate your spa configuration for automatic setup

## 1.9.1 (18.05.2020)
- Use of automatic Spa configuration to constrain lights
- Improved handling of intervals to check on Spa faults

## 1.9.0 (18.05.2020)
- Cleanup of Spa socket connection code for more robustness and recovery from error conditions
- Fix (untested) to pumps 5 and 6
- Use of automatic Spa configuration to constrain what messages can be sent and what accessories can be used.

## 1.8.4 (17.05.2020)
- Fix for lights, now we support one or two lights

## 1.8.2 (17.05.2020)
- Fix for single-speed pumps

## 1.8.1 (17.05.2020)
- Updated README
- Check for spa faults every 10 minutes
- Refactor code that reads Spa configuration automatically and ensure it is called at
  the earliest sensible time.

## 1.8.0 (17.05.2020)
- Read pumps (and their number of speeds), and lights, etc from the Spa automatically
- Use Pump speed determination for better logic on setting speeds (which was probably
  slightly broken for 1 speed pumps in the previous versions)

## 1.7.1 (16.05.2020)
- Beginnings of automatically determining number of pumps

## 1.7.0 (16.05.2020)
- Added support for 2 lights and 6 pumps (needs testing, since my spa has 1 light, 3 pumps...). If you used a prior version, even with just 1 light, your config will need updating.
- Some code and logging to aim towards automatic configuration

## Previous releases no changelog available



