import * as crc from "crc";
import type { Logger } from 'homebridge';
import * as net from "net";

export const FLOW_GOOD = "Good";
export const FLOW_LOW = "Low";
export const FLOW_FAILED = "Failed";
export const FLOW_STATES = [FLOW_GOOD, FLOW_LOW, FLOW_FAILED];
const FILTERSTATES = ['Off', 'Cycle 1', 'Cycle 2', 'Cycle 1 and 2'];
const HEATINGMODES = ['Ready', 'Rest', 'Ready in Rest'];

const CELSIUS = 'Celsius';
const FAHRENHEIT = 'Fahrenheit';

const PrimaryRequest = new Uint8Array([0x0a, 0xbf, 0x22]);
const GetFaultsMessageContents = new Uint8Array([0x20, 0xff, 0x00]);
const GetFaultsReply = new Uint8Array([0x0a,0xbf,0x28]);
// These will tell us how many pumps, lights, etc the Spa has
const ControlTypesMessageContents = new Uint8Array([0x00, 0x00, 0x01]);
const ControlTypesReply = new Uint8Array([0x0a,0xbf,0x2e]);

// This one is sent to us automatically every second - no need to request it
const StateReply = new Uint8Array([0xff,0xaf,0x13]);
// Sent if the user sets the spa time from the Balboa app
const PreferencesReply = new Uint8Array([0xff,0xaf,0x26]);

// These three either don't have a reply or we don't care about it.
const ToggleItemRequest = new Uint8Array([0x0a, 0xbf, 0x11]);
const LockPanelRequest = new Uint8Array([0x0a, 0xbf, 0x2d]);
const SetTimeOfDayRequest = new Uint8Array([0x0a, 0xbf, 0x21]);
const SetTargetTempRequest = new Uint8Array([0x0a, 0xbf, 0x20]);
// These we send once, but don't actually currently make use of the results
// Need to investigate how to interpret them. 
const ConfigRequest = new Uint8Array([0x0a, 0xbf, 0x04]);
const ConfigReply = new Uint8Array([0x0a,0xbf,0x94]);

// Four different request message contents and their reply codes. Unclear of the 
// purpose/value of all of them yet. Again we send each once.
const ControlPanelRequest : Uint8Array[][] = [
    [new Uint8Array([0x01,0x00,0x00]), new Uint8Array([0x0a,0xbf,0x23])],
    [new Uint8Array([0x02,0x00,0x00]), new Uint8Array([0x0a,0xbf,0x24])],
    [new Uint8Array([0x04,0x00,0x00]), new Uint8Array([0x0a,0xbf,0x25])],
    [new Uint8Array([0x08,0x00,0x00]), new Uint8Array([0x0a,0xbf,0x26])]
];

// Perhaps something to do with ChromaZone
const KnownUnknownReply = new Uint8Array([0xff,0xaf,0x32]);

export class SpaClient {
    socket?: net.Socket;
    // undefined means the light doesn't exist on the spa
    lightIsOn: (boolean | undefined)[];
    // takes values from 0 to pumpsSpeedRange[thisPump]
    pumpsCurrentSpeed: number[];
    // 0 means doesn't exist, else 1 or 2 indicates number of speeds for this pump
    pumpsSpeedRange: number[];

    // undefined if not on the spa, else 0-3
    blowerCurrentSpeed: (number|undefined);
    // 0 means doesn't exist, else 1-3 indicates number of speeds for the blower
    blowerSpeedRange: number;

    // undefined means the aux doesn't exist on the spa
    auxIsOn: (boolean | undefined)[];

    // undefined means the mister doesn't exist on the spa
    misterIsOn: (boolean | undefined);

    // Is Spa set to operate in FAHRENHEIT or CELSIUS
    temp_CorF: string;

    // If temp_CorF is FAHRENHEIT, temperatures are all stored as degrees F, integers 
    // (so the resolution is 1 degree F).
    // If temp_CorF is CELSIUS, temperatures are all stored as 2x degrees C, integers 
    // (so the resolution is 0.5 degrees C).
    currentTemp?: number;
    // When spa is in 'high' mode, what is the target temperature
    targetTempModeHigh?: number;
    // When spa is in 'low' mode, what is the target temperature
    targetTempModeLow?: number;
    // Is spa in low or high mode.
    tempRangeIsHigh: boolean;
    // Time of day, based on the last message we've received, according to the Spa 
    // (sync it with the Balboa mobile app if you wish)
    hour: number;
    minute: number;
    // ready, ready at rest, etc.
    heatingMode: string;
    priming: boolean;
    time_12or24: string;
    isHeatingNow: boolean;
    hasCirculationPump: boolean;
    circulationPumpIsOn: boolean;
    filtering: number;
    lockTheSettings: boolean;
    lockTheEntirePanel: boolean;
    hold: boolean;
    receivedStateUpdate: boolean;
    autoSetSpaClock: boolean = true;

    // Takes values from FLOW_STATES
    flow: string;
    // Once the Spa has told us what accessories it really has. Only need to do this once.
    accurateConfigReadFromSpa: boolean;
    // Should be true for almost all of the time, but occasionally the Spa's connection drops
    // and we must reconnect.
    private isCurrentlyConnectedToSpa: boolean;
    numberOfConnectionsSoFar: number = 0;
    liveSinceDate: Date;
    // Stored so that we can cancel intervals if needed
    faultCheckIntervalId: any;
    stateUpdateCheckIntervalId: any;
    // Can be set in the overall config to provide more detailed logging
    devMode: boolean;

    lastStateBytes = new Uint8Array();
    lastFaultBytes = new Uint8Array();

    temperatureHistory : (number|undefined)[] = new Array();

    constructor(public readonly log: Logger, public readonly host: string, 
      public readonly spaConfigurationKnownCallback: () => void, 
      public readonly changesCallback: () => void, 
      public readonly reconnectedCallback: () => void, devMode?: boolean) {
        this.accurateConfigReadFromSpa = false;
        this.isCurrentlyConnectedToSpa = false;
        this.devMode = (devMode ? devMode : false);
        // Be generous to start. Once we've read the config we will reduce the number of lights
        // if needed.
        this.lightIsOn = [false,false];
        this.auxIsOn = [false, false];
        this.misterIsOn = false;
        // Be generous to start.  Once we've read the config, we'll set reduce
        // the number of pumps and their number of speeds correctly
        this.pumpsCurrentSpeed = [0,0,0,0,0,0];
        this.pumpsSpeedRange = [2,2,2,2,2,2];
        this.blowerCurrentSpeed = 0;
        this.blowerSpeedRange = 0;
        // All of these will be set by the Spa as soon as we get the first status update
        this.currentTemp = undefined;
        this.hour = 12;
        this.minute = 0;
        this.heatingMode = "";
        this.temp_CorF = "";
        this.tempRangeIsHigh = true;
        this.targetTempModeLow = undefined;
        this.targetTempModeHigh = undefined;
        this.priming = false;
        this.time_12or24 = "12 Hr";
        this.isHeatingNow = false;
        this.hasCirculationPump = false;
        this.circulationPumpIsOn = false;
        this.filtering = 0;
        this.lockTheSettings = false;
        this.lockTheEntirePanel = false;
        this.hold = false;
        this.receivedStateUpdate = true;
        // This isn't updated as frequently as the above
        this.flow = FLOW_GOOD;
        this.liveSinceDate = new Date();
        // Our communications channel with the spa
        this.socket = this.get_socket(host);
        // Record temperature history - every 30 minutes
        setInterval(() => {
            this.recordTemperatureHistory();
        }, 30 * 60 * 1000);
    }

    get_socket(host: string) {
        if (this.isCurrentlyConnectedToSpa) {
            this.log.error("Already connected, should not be trying again.");
        }

        this.log.debug("Connecting to Spa at", host, "on port 4257");
        this.socket = net.connect({
            port: 4257, 
            host: host
        }, () => {
            this.numberOfConnectionsSoFar++;
            this.liveSinceDate.getUTCDay
            const diff = Math.abs(this.liveSinceDate.getTime() - new Date().getTime());
            const diffDays = Math.ceil(diff / (1000 * 3600 * 24)); 
            this.log.info('Successfully connected to Spa at', host, 
                'on port 4257. This is connection number', this.numberOfConnectionsSoFar,
                'in', diffDays, 'days');
            this.successfullyConnectedToSpa();
        });
        this.socket?.on('end', () => {
            this.log.debug("SpaClient: disconnected:");
        });
        // If we get an error, then retry
        this.socket?.on('error', (error: any) => {
            this.log.debug(error);
            this.log.info("Had error - closing old socket, retrying in 20s");
            
            this.shutdownSpaConnection();
            this.reconnect(host);
        });
        
        return this.socket;
    }

    successfullyConnectedToSpa() {
        this.isCurrentlyConnectedToSpa = true;
        // Reset our knowledge of the state, since it will
        // almost certainly be out of date.
        this.resetRecentState();
        
        // Update homekit right away, and then again once some data comes in.
        // this.changesCallback();

        // listen for new messages from the spa. These can be replies to messages
        // We have sent, or can be the standard sending of status that the spa
        // seems to do every second.
        this.socket?.on('data', (data: any) => {
            const bufView = new Uint8Array(data);
            this.readAndActOnSocketContents(bufView);
        });

        // No need to do this once we already have all the config information once.
        if (!this.accurateConfigReadFromSpa) {
            // Get the Spa's primary configuration of accessories right away
            this.sendControlTypesRequest();

            // Some testing things. Not yet sure of their use.
            // Note: must use 'let' here so id is bound separately each time.
            for (let id=0;id<4;id++) {
                setTimeout(() => {
                    this.sendControlPanelRequest(id);
                }, 1000*(id+1));
            }
            setTimeout(() => {
                this.send_config_request();
            }, 15000);  
        }

        // Wait 5 seconds after startup to send a request to check for any faults
        setTimeout(() => {
            if (this.isCurrentlyConnectedToSpa) {
                this.send_request_for_faults_log();
            }
            if (this.faultCheckIntervalId) {
                this.log.error("Shouldn't ever already have a fault check interval running here.");
            }
            // And then request again once every 10 minutes.
            this.faultCheckIntervalId = setInterval(() => {
                if (this.isCurrentlyConnectedToSpa) {
                    this.send_request_for_faults_log();
                }
            }, 10 * 60 * 1000);
        }, 5000);

        // Every 15 minutes, make sure we update the log. And if we haven't
        // received a state update, then message the spa so it starts sending
        // us messages again.
        if (this.stateUpdateCheckIntervalId) {
            this.log.error("Shouldn't ever already have a state update check interval running here.");
        }
        this.stateUpdateCheckIntervalId = setInterval(() => {
            if (this.isCurrentlyConnectedToSpa) {
                this.checkWeHaveReceivedStateUpdate();
            }
        }, 15 * 60 * 1000)
        
        // Call to ensure we catch up on anything that happened while we
        // were disconnected.
        this.reconnectedCallback();
    }

    lastIncompleteChunk: (Uint8Array|undefined) = undefined;
    lastChunkTimestamp: (Date|undefined) = undefined;

    /**
     * We got some data from the Spa. Often one "chunk" exactly equals one message.
     * But sometimes a single chunk will contain multiple messages back to back, and
     * so we need to process each in turn. And sometimes a chunk will not contain a full
     * message - it is incomplete - and we should store it and wait for the rest to
     * arrive (or discard it if the rest doesn't arrive).
     * 
     * @param chunk 
     */
    readAndActOnSocketContents(chunk: Uint8Array) {
        // If we have a lastIncompleteChunk, then it may be the new chunk is just what is needed to
        // complete that.
        if (this.lastIncompleteChunk) {
            const diff = Math.abs(this.lastChunkTimestamp!.getTime() - new Date().getTime());
            if (diff < 1000) {
                // Merge the messages, if timestamp difference less than 1 second
                chunk = this.concat(this.lastIncompleteChunk, chunk);
                this.log.debug("Merging messages of length", this.lastIncompleteChunk.length, "and", chunk.length);
            } else {
                this.log.warn("Discarding old, incomplete message", this.prettify(this.lastIncompleteChunk));
            }
            this.lastIncompleteChunk = undefined;
            this.lastChunkTimestamp = undefined;
        }

        let messagesProcessed = 0;

        while (chunk.length > 0) {
            if (chunk.length < 2) {
                this.log.error("Very short message received (ignored)", this.prettify(chunk));
                break;
            }
            // Length is the length of the message, which excludes the checksum and 0x7e end.
            const msgLength = chunk[1];

            if (msgLength > (chunk.length-2)) {
                // Cache this because more contents is coming in the next packet, hopefully
                this.lastIncompleteChunk = chunk;
                this.lastChunkTimestamp = new Date();
                this.log.debug("Incomplete message received (awaiting more data)", this.prettify(chunk), 
                    "missing", (msgLength - chunk.length +2), "bytes");
                break;
            }
            // We appear to have a full message, perhaps more than one.
            if (chunk[0] == 0x7e && chunk[msgLength+1] == 0x7e) {
                // All spa messages start and end with 0x7e
                if (msgLength > 0) {
                    const thisMsg = chunk.slice(0, msgLength+2);
                    const checksum = thisMsg[msgLength];
                    // Seems like a good message. Check the checksum is ok
                    if (checksum != this.compute_checksum(new Uint8Array([msgLength]), thisMsg.slice(2,msgLength))) {
                        this.log.error("Bad checksum", checksum, "for", this.prettify(thisMsg));
                    } else {
                        const somethingChanged = this.readAndActOnMessage(msgLength, checksum, thisMsg);
                        if (somethingChanged) {
                            // Only log state when something has changed.
                            this.log.debug("State change:", this.stateToString());
                            // Call whoever has registered with us - this is our homekit platform plugin
                            // which will arrange to go through each accessory and check if the state of
                            // it has changed. There are 3 cases here to be aware of:
                            // 1) The user adjusted something in Home and therefore this callback is completely
                            // unnecessary, since Home is already aware.
                            // 2) The user adjusted something in Home, but that change could not actually take
                            // effect - for example the user tried to turn off the primary filter pump during
                            // a filtration cycle, and the Spa will ignore such a change.  In this case this
                            // callback is essential for the Home app to reflect reality
                            // 3) The user adjusted something using the physical spa controls (or the Balboa app),
                            // and again this callback is essential for Home to be in sync with those changes.
                            //
                            // Theoretically we could be cleverer and not call this for the unnecessary cases, but
                            // that seems like a lot of complex work for little benefit.  Also theoretically we
                            // could specify just the controls that have changed, and hence reduce the amount of
                            // activity.  But again little genuine benefit really from that, versus the code complexity
                            // it would require.
                            this.changesCallback();
                        }
                    }
                } else {
                    // Message length zero means there is no content at all. Not sure if this ever happens,
                    // but no harm in just ignoring it.
                }
                messagesProcessed++;
            } else {
                // Message didn't start/end correctly
                this.log.error("Message with bad terminations encountered:", this.prettify(chunk));
            }
            // Process rest of the chunk, as needed (go round the while loop).
            // It might contain more messages
            chunk = chunk.slice(msgLength+2);
        }
        return messagesProcessed;
    }   

    checkWeHaveReceivedStateUpdate() {
        if (this.receivedStateUpdate) {
            // All good - reset for next time
            this.log.info('Latest spa state', this.stateToString());
            this.receivedStateUpdate = false;

            // We use this periodic occasion to see if we should correct the Spa's clock
            this.checkAndSetTimeOfDay();
        } else {
            this.log.error('No spa state update received for some time.  Last state was', 
                this.stateToString());
            
            // TODO - it would be nice if there was a softer way of getting the spa
            // to start sending the status updates again then a full disconnect, reconnect.
            // For example, perhaps there is a simple message we send which will trigger that
            
            this.socket?.emit("error", Error("no spa update"));
        }
    }

    reconnecting: boolean = false;
    reconnect(host: string) {
        if (!this.reconnecting) {
            this.reconnecting = true;
            setTimeout(() => {
                this.socket = this.get_socket(host);
                this.reconnecting = false;
            }, 20000);
        }
    }

    // Used if we get an error on the socket, as well as during shutdown.
    // If we got an error, after this the code will retry to recreate the
    // connection (elsewhere).
    shutdownSpaConnection() {
        // Might already be disconnected, if we're in a repeat error situation.
        this.isCurrentlyConnectedToSpa = false;
        this.log.debug("Shutting down Spa socket");
        if (this.faultCheckIntervalId) {
            clearInterval(this.faultCheckIntervalId);
            this.faultCheckIntervalId = undefined;
        }
        if (this.stateUpdateCheckIntervalId) {
            clearInterval(this.stateUpdateCheckIntervalId);
            this.stateUpdateCheckIntervalId = undefined;
        }
        // Not sure I understand enough about these sockets to be sure
        // of best way to clean them up.
        if (this.socket != undefined) {
            this.socket.end();
            this.socket.destroy();
            this.socket = undefined;
        }
    }

    hasGoodSpaConnection() {
        return this.isCurrentlyConnectedToSpa;
    }
    
    // Called every half hour
    recordTemperatureHistory() {
        this.temperatureHistory.push(this.getCurrentTemp());
        if (this.temperatureHistory.length == 48) {
            this.log.info("Temperature for last day (half hour intervals):", this.temperatureHistory.toString());
            this.temperatureHistory = new Array();
        }
    }

    /**
     * Message starts and ends with 0x7e. Needs a checksum.
     * @param purpose purely for logging clarity
     * @param type 
     * @param payload 
     */
    sendMessageToSpa(purpose: string, type: Uint8Array, payload: Uint8Array) {
        const length = (5 + payload.length);
        const typepayload = this.concat(type, payload);
        const checksum = this.compute_checksum(new Uint8Array([length]), typepayload);
        const prefixSuffix = new Uint8Array([0x7e]);
        let message = this.concat(prefixSuffix, new Uint8Array([length]));
        message = this.concat(message, typepayload);
        message = this.concat(message, new Uint8Array([checksum]));
        message = this.concat(message, prefixSuffix);
        if (this.devMode) {
            this.log.info("DEV Sending (" + purpose + "):" + this.prettify(message));
        } else {
            this.log.debug("Sending (" + purpose + "):" + this.prettify(message));
        }
        this.socket?.write(message);
    }

    /**
     * Turn the bytes into a nice hex, comma-separated string like '0a,bf,2e'
     * @param message the bytes
     */
    prettify(message: Uint8Array) {
        return Buffer.from(message).toString('hex').match(/.{1,2}/g);
    }
    getTargetTemp() {
        return this.convertSpaTemperatureToExternal(this.tempRangeIsHigh 
            ? this.targetTempModeHigh! : this.targetTempModeLow!);
    }
    getTempIsCorF() {
        return this.temp_CorF;
    }

    convertTempToC(temp: number) {
        if (temp == undefined) return undefined;
        if (this.getTempIsCorF() === CELSIUS) {
            return temp;
        } else {
            return (temp-32.0)*5/9;
        }
    }

    convertTempFromC(temp: number) {
        if (temp == undefined) return undefined;
        if (this.getTempIsCorF() === CELSIUS) {
            return temp;
        } else {
            return (temp*9/5.0)+32.0;
        }
    }

    getTempRangeIsHigh() {
        return this.tempRangeIsHigh;
    }
    timeToString(hour: number, minute: number) {
        return hour.toString().padStart(2, '0') + ":" + minute.toString().padStart(2, '0');
    }
    getIsLightOn(index: number) {
        // Lights are numbered 1,2 by Balboa
        index--;
        return this.lightIsOn[index];
    }

    setMisterState(value: boolean) {
        if ((this.misterIsOn === value)) {
            return;
        }
        if (this.misterIsOn == undefined) {
            this.log.error("Trying to set state of mister which doesn't exist");
            return;
        }
        if (!this.isCurrentlyConnectedToSpa) {
            // Should we throw an error, or how do we handle this?
        }
        const id = 0x0e;
        this.send_toggle_message('Mister', id);
        this.misterIsOn = value;

    }

    getIsMisterOn() {
        return this.misterIsOn;
    }

    setAuxState(index: number, value: boolean) {
        // Aux are numbered 1,2 by Balboa
        index--;
        if ((this.auxIsOn[index] === value)) {
            return;
        }
        if (this.auxIsOn[index] == undefined) {
            this.log.error("Trying to set state of aux",(index+1),"which doesn't exist");
            return;
        }
        if (!this.isCurrentlyConnectedToSpa) {
            // Should we throw an error, or how do we handle this?
        }
        const id = 0x16+index;
        this.send_toggle_message('Aux'+(index+1), id);
        this.auxIsOn[index] = value;
    }
    
    getIsAuxOn(index: number) {
        index--;
        return this.auxIsOn[index];
    }

    getIsHold() {
        return this.hold;
    }
    setIsHold(value: boolean) {
        if (this.hold == value) return;
        this.send_toggle_message('Hold', 0x3c);
        this.hold = value;
    }

    getIsLocked(entirePanel: boolean) {
        return entirePanel ? this.lockTheEntirePanel : this.lockTheSettings;
    }
    setIsLocked(entirePanel: boolean, value: boolean) {
        if (this.getIsLocked(entirePanel) == value) return;
        this.send_lock_settings(entirePanel, value);
        if (entirePanel) {
            this.lockTheEntirePanel = value;
        } else {
            this.lockTheSettings = value;
        }
    }

    getIsHeatingNow() {
        return this.isHeatingNow;
    }

    // Three-state: ready, rest, ready-at-rest (the latter indicating it is in 'rest' mode and a
    // pump has been turned on so the spa will heat if necessary). This is what is shown in
    // the spa display.
    getHeatingMode() {
        return this.heatingMode;
    }

    // See below
    isHeatingModeAlwaysReady() {
        return (this.heatingMode == 'Ready');
    }

    /** 
     * Boolean either
     * - 'ready' (always heating if needed) or
     * - 'rest' (only heating when a pump is running)
     * 
     * In winter it is advisable to keep the spa in ready mode (at a low temperature if preferred)
     * to avoid freezing.
     */
    setHeatingModeAlwaysReady(isAlwaysReady: boolean) {
        const isSetToAlwaysReady = (this.heatingMode == 'Ready');
        if (isSetToAlwaysReady == isAlwaysReady) {
            // Already set correctly
            return;
        }
        this.send_toggle_message('Heating Mode', 0x51);
        this.heatingMode = HEATINGMODES[isAlwaysReady? 0 : 1];
    }

    /**
     * Returns in C or F depending on what the user has defined in the Spa
     * control panel. 
     */
    getCurrentTemp() {
        if (this.currentTemp == undefined) {
            return undefined;
        } else {
            return this.convertSpaTemperatureToExternal(this.currentTemp);
        }
    }

    setLightState(index: number, value: boolean) {
        // Lights are numbered 1,2 by Balboa
        index--;
        if ((this.lightIsOn[index] === value)) {
            return;
        }
        if (this.lightIsOn[index] == undefined) {
            this.log.error("Trying to set state of light",(index+1),"which doesn't exist");
            return;
        }
        if (!this.isCurrentlyConnectedToSpa) {
            // Should we throw an error, or how do we handle this?
        }
        const id = 0x11+index;
        this.send_toggle_message('Light'+(index+1), id);
        this.lightIsOn[index] = value;
    }

    setTempRangeIsHigh(isHigh: boolean) {
        if ((this.tempRangeIsHigh === isHigh)) {
            return;
        }
        this.send_toggle_message('TempHighLowRange', 0x50);
        this.tempRangeIsHigh = isHigh;
    }

    getFlowState() {
        return this.flow;
    }

    getPumpSpeedRange(index: number) {
        if (index == 0) {
            return (this.hasCirculationPump ? 1 : 0);
        } else {
            return this.pumpsSpeedRange[index-1];
        }
    }

    static getSpeedAsString(range: number, speed: number) {
        if (range == 1) {
            return ["Off", "High"][speed];
        } else if (range == 2) {
            return ["Off", "Low", "High"][speed];
        } else if (range == 3) {
            return ["Off", "Low", "Medium", "High"][speed];
        } else {
            return undefined;
        }
    }

    getPumpSpeed(index: number) {
        if (index == 0) {
            if (this.hasCirculationPump) {
                return this.circulationPumpIsOn ? 1 : 0;
            } else {
                this.log.error("Trying to get speed of circulation pump which doesn't exist");
                return 0;
            }
        }
        // Pumps are numbered 1,2,3,... by Balboa
        index--;
        if (this.pumpsSpeedRange[index] == 0) {
            this.log.error("Trying to get speed of pump",(index+1),"which doesn't exist");
            return 0;
        }
        return this.pumpsCurrentSpeed[index];
    }

    getBlowerSpeedRange() {
        return this.blowerSpeedRange;
    }

    getBlowerSpeed() {
        if (this.blowerCurrentSpeed === undefined) {
            this.log.error("Trying to get speed of blower, which doesn't exist");
            return 0;
        }
        return this.blowerCurrentSpeed!;
    }

    setBlowerSpeed(desiredSpeed: number) {
        if (this.blowerCurrentSpeed === undefined) {
            this.log.error("Trying to set speed of blower, which doesn't exist");
            return;
        }
        const numberOfStates = 4;
        const oldIdx = this.blowerCurrentSpeed!;
        let toggleCount = (numberOfStates + desiredSpeed - oldIdx) % numberOfStates;
        // Anything from 0 to 3 toggles needed.
        while (toggleCount > 0) {
            this.send_toggle_message('Blower', 0x0c);
            toggleCount--;
        }
        this.blowerCurrentSpeed = desiredSpeed;
    }

    /**
     * A complication here is that, during filtration cycles, a pump might be locked into an "on"
     * state.  For example on my Spa, pump 1 goes into "low" state, and I can switch it to "high", but
     * a toggle from "high" does not switch it off, but rather switches it straight to "low" again.
     * With single-speed pumps this isn't such an issue, but with 2-speed pumps, this behaviour causes 
     * problems for the easiest approach to setting the pump to a particular speed.  When we calculate that
     * two 'toggles' are needed, the reality is that sometimes it might just be one, and hence two
     * toggles will end us in the wrong pump speed.  There are really just two specific case that are 
     * annoying as a user:
     * 
     * 1) the pump is "High". Desired speed is "Low". Hence we deduce the need for
     * two toggles. But, since "Off" is skipped, we end up back where we started in "High".
     * 
     * 2) we're trying to turn the pump off, but it can't be turned off. We need to make sure
     * the ending state is correctly reflected in Home.
     * 
     * @param index pump number (1-6) convert to index lookup (0-5) convert to Balboa message id (4-9)
     * @param desiredSpeed 0...pumpsSpeedRange[index] depending on speed range of the pump
     */
    setPumpSpeed(index: number, desiredSpeed: number) {
        // Pump 0 is the circulation pump, whose state cannot be set
        if (index == 0) {
            if (desiredSpeed == 0) {
                // Anytime we turn a pump off, ensure that all remembered state information
                // is forgotten, so the next information from the Spa will tell us what is
                // actually going on, and we'll update Home if necessary.
                this.resetRecentState();
            }
            return;
        }

        const pumpName = 'Pump' + index;
        // Pumps are numbered 1,2,3,... by Balboa
        index--;
        if (this.pumpsCurrentSpeed[index] === desiredSpeed) {
            // No action needed if pump already at the desired speed
            return;
        }
        if (this.pumpsSpeedRange[index] == 0) {
            this.log.error("Trying to set speed of", pumpName, "which doesn't exist");
            return;
        }
        if (desiredSpeed > this.pumpsSpeedRange[index]) {
            this.log.error("Trying to set speed of", pumpName, " faster (",desiredSpeed,
              ") than the pump supports (",this.pumpsSpeedRange[index] ,").");
            return;
        }
        // Toggle Pump1 = toggle '4', Pump2 = toggle '5', etc.
        const balboaPumpId = index+4;
        if (this.pumpsSpeedRange[index] == 1) {
            // It is a 1-speed pump
            // Any change requires just one toggle. It's either from off to high or high to off
            this.send_toggle_message(pumpName, balboaPumpId);
            this.pumpsCurrentSpeed[index] = desiredSpeed;
        } else {
            // How many toggles do we need to get from the current speed
            // to the desired speed?  For a 2-speed pump, allowed speeds are 0,1,2.
            // This code (but not other code in this class) should actually 
            // work as-is for 3-speed pumps if they exist.
            const numberOfStates = this.pumpsSpeedRange[index]+1;
            const oldIdx = this.pumpsCurrentSpeed[index];
            const newIdx = desiredSpeed;
            // For a 2-speed pump, we'll need to toggle either 1 or 2 times.
            let toggleCount = (numberOfStates + newIdx - oldIdx) % numberOfStates;
            if (toggleCount == 2 && desiredSpeed === 1) {
                // Deal with the edge-case complication remarked on above.  
                // Send one toggle message
                this.send_toggle_message(pumpName, balboaPumpId);
                this.pumpsCurrentSpeed[index] = 0;
                // Then wait a little bit to check what state the pump is in, before
                // continuing - either we need to do nothing, or we need to do one more
                // toggle.
                if (this.devMode) {
                    this.log.info("DEV Edge case triggered on", pumpName);
                }
                // TODO: is this the right amount of waiting? Should we try to explicitly 
                // synchronise this with the next status update message?
                setTimeout(() => {
                    if (this.pumpsCurrentSpeed[index] === 0) {
                        // This is the normal case. We still have one more toggle to do.
                        this.send_toggle_message(pumpName, balboaPumpId);
                        this.pumpsCurrentSpeed[index] = 1;
                    } else {
                        // Spa is in filter mode where this specific pump is not
                        // allowed to turn off. It's already in the right state.
                        if (this.devMode) {
                            this.log.info("DEV Pump already in correct state");
                        }
                    }
                }, 500);
            } else {
                while (toggleCount > 0) {
                    this.send_toggle_message(pumpName, balboaPumpId);
                    toggleCount--;
                }
                this.pumpsCurrentSpeed[index] = desiredSpeed;
            }
        }
        // The other edge case where we try to turn a pump off
        // that cannot currently be turned off (scheduled filtering).
        if (desiredSpeed == 0) {
            // Anytime we turn a pump off, ensure that all remembered state information
            // is forgotten, so the next information from the Spa will tell us what is
            // actually going on, and we'll update Home if necessary.
            this.resetRecentState();
        }

    }

    compute_checksum(length: Uint8Array, bytes: Uint8Array) {
        const checksum = crc.crc8(Buffer.from(this.concat(length, bytes)), 0x02);
        return checksum ^ 0x02;
    }
    
    concat(a: Uint8Array, b: Uint8Array) {
        const c = new Uint8Array(a.length + b.length);
        c.set(a);
        c.set(b, a.length);
        return c;
    }

    // Temperatures which are out of certain bounds will be rejected by the spa.
    // We don't do bounds-checking ourselves.
    setTargetTemperature(temp: number) {
        let sendTemp;
        if (this.tempRangeIsHigh) {
            this.targetTempModeHigh = this.convertExternalTemperatureToSpa(temp);
            sendTemp = this.targetTempModeHigh;
        } else {
            this.targetTempModeLow = this.convertExternalTemperatureToSpa(temp);
            sendTemp = this.targetTempModeLow;
        }
        this.sendMessageToSpa("SetTargetTempRequest", SetTargetTempRequest, new Uint8Array([sendTemp]));
    }

    checkAndSetTimeOfDay() {
        const date = new Date();
        const hr = date.getHours();
        const min = date.getMinutes();
        if (Math.abs((hr*60+min) - (this.hour * 60 + this.minute)) > 10) {
            // Spa's time seems to be different to my time. We trust that the computer we are
            // running this code on is more likely to have the correct time than the Spa.
            // So we change the Spa's time.
            if (this.autoSetSpaClock) {
                this.sendMessageToSpa("SetSpaTimeOfDay", SetTimeOfDayRequest, new Uint8Array([hr, min]));
            }
        }
    }

    send_config_request() {
        this.sendMessageToSpa("ConfigRequest", ConfigRequest, new Uint8Array());
    }

    sendControlTypesRequest() {
        this.sendMessageToSpa("ControlTypesRequest", PrimaryRequest, ControlTypesMessageContents);
    }

    sendControlPanelRequest(id : number) {
        // 4 messages from [0x01,0x00,0x00] through 2,4,8
        this.sendMessageToSpa("ControlPanelRequest"+(id+1), PrimaryRequest, ControlPanelRequest[id][0]);
    }

    send_request_for_faults_log() {
        this.sendMessageToSpa("Checking for any Spa faults", PrimaryRequest, GetFaultsMessageContents);   
    }

    /**
     * Most of the Spa's controls are "toggles" - i.e. we don't set a pump to a specific
     * speed, or turn a light on, but rather we increment or toggle the state of a device,
     * so the same action turns a light on as off, and to get a 2-speed pump from off to high
     * we need to toggle it twice.  Here are the known codes:
     *  - 0x04 to 0x09 - pumps 1-6
     *  - 0x11-0x12 - lights 1-2
     *  - 0x3c - hold. Hold mode is used to disable the pumps during service 
     *  functions like cleaning or replacing the filter.  Hold mode will last for 1 hour
     *  unless the mode is exited manually.
     *  - 0x50 - temperature range (high or low)
     *  - 0x0c - blower
     *  - 0x0e - mister
     *  - 0x16 - aux1
     *  - 0x17 - aux2
     *  - 0x51 - heating mode (ready = always trying to maintain temperature, rest = only
     *           heat when pumps are running)
     *  
     *  The spa may also have two "lock" settings - locking the control panel completely, or
     *  just locking the settings (but allowing jets and lights, say, to still be used). Those
     *  are set below in 'send_lock_settings' and do not use the toggle mechanism.
     */
    send_toggle_message(itemName: string, code: number) {
        if (code > 255) {
            this.log.error("Toggle only a single byte; had " + code);
            return;
        }
        // All of these codes form a 2-byte message - the code and zero.
        // (no idea why, nor if making that zero something else will change the
        // outcome).
        this.sendMessageToSpa("Toggle " + itemName + ", using code:"+ code, 
            ToggleItemRequest, new Uint8Array([code, 0x00]));
    }

    // See https://github.com/ccutrer/balboa_worldwide_app/wiki#lock-request
    // 1 = lock settings, 2 = lock panel, 3 = unlock settings, 4 = unlock panel
    send_lock_settings(entirePanel: boolean, lock: boolean) {
        const value = (entirePanel ? 1 : 0) + (lock ? 1 : 3);
        this.sendMessageToSpa("Lock", LockPanelRequest, new Uint8Array([value]));   
    }

    // Celsius temperatures are stored/communicated by the Spa in half degrees.
    // So '80' stored/sent by the Spa means 40.0 degrees celsius, IF the spa
    // is operating in Celsius. If in Fahrenheit then no conversions needed.
    convertSpaTemperatureToExternal(temperature : number) {
        if (this.temp_CorF === FAHRENHEIT) return temperature;
        // It's a celsius value which needs either dividing or multiplying by 2
        return temperature/2.0;
    }

    // Celsius temperatures are stored/communicated by the Spa in half degrees.
    // So '80' stored/sent by the Spa means 40.0 degrees celsius, IF the spa
    // is operating in Celsius. If in Fahrenheit then no conversions needed.
    convertExternalTemperatureToSpa(temperature : number) {
        if (this.temp_CorF === FAHRENHEIT) return temperature;
        return Math.round(temperature * 2.0);
    }

    internalTemperatureToString(temperature? : number) {
        if (temperature == undefined) return "Unknown";
        if (this.temp_CorF === FAHRENHEIT) return temperature.toString() + "F";
        return this.convertSpaTemperatureToExternal(temperature).toFixed(1).toString() + "C"; 
    }

    stateToString() {
        let pumpDesc = '[';
        for (let i = 0; i<6;i++) {
            if (this.pumpsSpeedRange[i] > 0) {
                pumpDesc += SpaClient.getSpeedAsString(this.pumpsSpeedRange[i],this.pumpsCurrentSpeed[i]) + ' ';
            }
        }
        pumpDesc += ']';

        const s = "Temp: " + this.internalTemperatureToString(this.currentTemp) 
        + ", Temp Range: " + (this.tempRangeIsHigh ? "High" : "Low")
        + ", Target Temp(H): " + this.internalTemperatureToString(this.targetTempModeHigh) 
        + ", Target Temp(L): " + this.internalTemperatureToString(this.targetTempModeLow) 
        + ", Time: " + this.timeToString(this.hour, this.minute)
        + ", Priming: " + this.priming.toString()
        + ", Heating Mode: " + this.heatingMode 
        + ", Temp Scale: " + this.temp_CorF
        + ", Time Scale: " + this.time_12or24  
        + ", Heating: " + this.isHeatingNow 
        + ", Pumps: " + pumpDesc
        + (this.hasCirculationPump ? ", Circ Pump: " + (this.circulationPumpIsOn ? "On" : "Off") : "")
        + ", Filtering: " + FILTERSTATES[this.filtering]
        + ", Lights: [" + this.lightIsOn + "]"
        + (this.blowerCurrentSpeed != undefined ? ", Blower: " + this.blowerCurrentSpeed : "")
        + (this.misterIsOn != undefined ? ", Mister: " + this.misterIsOn : "")
        + ", Aux: [" + this.auxIsOn + "]"
        + (this.lockTheEntirePanel ? ", Panel locked" : "")
        + (this.lockTheSettings ? ", Settings locked" : "")
        + (this.hold ? ", Hold mode activated" : "")
        return s;
    }

    /**
     * Return true if anything in the state has changed as a result of the message
     * received.
     * 
     * @param length
     * @param checksum
     * @param chunk - first and last bytes are 0x7e. Second byte is message length.
     * Second-last byte is the checksum.  Then bytes 3,4,5 are the message type.
     * Everything in between is the content.
     */
    readAndActOnMessage(length: number, checksum: number, chunk: Uint8Array) {
        if (chunk[0] != 0x7e || chunk[1] != length || chunk[length] != checksum || chunk[length+1] != 0x7e || chunk.length != (length+2)) {
            this.log.error("Bad internal data in message handling. Please report a bug:", 
              length, checksum, this.prettify(chunk));
            return false;
        }
        const contents = chunk.slice(5, length);
        const msgType = chunk.slice(2,5);
        let stateChanged : boolean;
        let avoidHighFreqDevMessage : boolean = true;
        if (this.equal(msgType,StateReply)) {
            stateChanged = this.readStateFromBytes(contents);
            avoidHighFreqDevMessage = stateChanged;
        } else if (this.equal(msgType, GetFaultsReply)) {
            stateChanged = this.readFaults(contents);
        } else if (this.equal(msgType, ControlTypesReply)) {
            this.log.info("Control types reply(" + this.prettify(msgType) 
             + "):"+ this.prettify(contents));
            stateChanged = this.interpretControlTypesReply(contents);
        } else if (this.equal(msgType, ConfigReply)) {
            this.log.info("Config reply with MAC address (" + this.prettify(msgType) 
            + "):"+ this.prettify(contents));
            // Bytes 3-8 are the MAC address of the Spa.  They are also repeated later
            // on in the string, but split into two halves with two bytes inbetween (ff, ff)
            stateChanged = false;
        } else if (this.equal(msgType, PreferencesReply)) {
            // Nothing to do here
            this.log.info("Set preferences reply (" + this.prettify(msgType) 
            + "):"+ this.prettify(contents));
            stateChanged = false;
        } else if (this.equal(msgType, KnownUnknownReply)) {
            // Nothing to do here
            stateChanged = false;
        } else {
            stateChanged = false;
            let recognised = false;
            for (let id = 0; id<4; id++) {
                if (this.equal(msgType, ControlPanelRequest[id][1])) {
                    stateChanged = this.interpretControlPanelReply(id+1, contents);
                    recognised = true;
                    break;
                }
            }
            // Various messages about controls, filters, etc. In theory we could
            // choose to implement more things here, but limited value in it.
            if (!recognised) {
                this.log.info("Not understood a received spa message", 
                "(nothing critical, but please do report this):" + this.prettify(msgType), 
                " contents: "+ this.prettify(contents));
            }
        }
        if (this.devMode && avoidHighFreqDevMessage) {
            // If dev mode is activated, then log it, with info level.  Unless it is
            // just the high frequencing status message (and no state has changed).
            this.log.info("DEV Received:" + this.prettify(msgType) + ":" + this.prettify(contents));
        }
        return stateChanged;
    }

    /**
     * By resetting our knowledge of recent state, we ensure the next time the spa reports 
     * its state, that we broadcast that to Homekit as an update. This is useful whenever
     * we have reason to believe the state might be out of sync. We therefore use it for
     * two purposes: (a) immediately after a (re)connection with the spa, (b) when we try
     * to turn a pump off, but believe it might not be allowed to be off.
     */
    resetRecentState() {
        this.lastStateBytes = new Uint8Array();
        this.lastFaultBytes = new Uint8Array();
    }

    /**
     * Interpret the standard response, which we are sent about every 1 second, covering
     * all of the primary state of the spa.
     * 
     * Return true if anything important has changed (e.g. ignore the time changing!)
     */
    readStateFromBytes(bytes: Uint8Array) {
        this.receivedStateUpdate = true;

        // Seems like priming goes through different states, so not sure this simplicity is correct
        this.priming = ((bytes[1] & 1) === 1);
        // If current_temp = 255, then the Spa is still not fully initialised
        // (but is not necessarily in "priming" state). Need to wait, really - after some seconds the
        // correct temperature is read.
        // Probably better to say the temperature is unknown, if homekit supports that.  The Balboa
        // app, for what it's worth, also is confused when current temp = 255.  We currently report
        // 'undefined' here, which our temperature accessory turns into a 'null' to send to Homekit.
        this.currentTemp = (bytes[2] == 255 ? undefined : bytes[2]);
        this.hour = bytes[3];
        this.minute = bytes[4];
        // Three possible states for heating mode. We can only set it to two states though.
        this.heatingMode = HEATINGMODES[bytes[5]];
        // Byte 6 = unknown/zero
        // Byte 7 = Sensor A Temperature / Hold Timer: Minutes if Hold Mode else Temperature 
        // (scaled by Temperature Scale) if A/B Temps else 0x00
        // Byte 8 = 0x00 if A/B Temps if OFF else Temperature (scaled by Temperature Scale)

        // Byte 9 = Temperature Scale, Clock Mode, Filter Mode
        const variousFlags = bytes[9];
        this.temp_CorF = (((variousFlags & 1) === 0) ? FAHRENHEIT : CELSIUS);
        this.time_12or24 = (((variousFlags & 2) === 0) ? "12 Hr" : "24 Hr");
        // Filtering mode we just put in the log. It has 4 states (off, cycle1, cycle2, cycle 1 and 2)
        this.filtering = (variousFlags & 0x0c) >> 2; // values of 0,1,2,3
        this.lockTheSettings = (variousFlags & 0x10) != 0;
        this.lockTheEntirePanel = (variousFlags & 0x20) != 0;
        const moreFlags = bytes[10];
        // It seems some spas have 3 states for this, idle, heating, heat-waiting.
        // We merge the latter two into just "heating" - there are two bits here though.
        this.isHeatingNow = ((moreFlags & 48) !== 0);
        this.tempRangeIsHigh = (((moreFlags & 4) === 0) ? false : true);
        // moreFlags & 8 is normally =8, but when we put the spa into "hold" it switches to 0,
        // and bytes[22] is set to 64.
        const pump_status1234 = bytes[11];
        // We have a correct determination of the number of pumps automatically.
        this.pumpsCurrentSpeed[0] = this.internalSetPumpSpeed(this.pumpsSpeedRange[0], 
            (pump_status1234 & (1+2)));
        this.pumpsCurrentSpeed[1] = this.internalSetPumpSpeed(this.pumpsSpeedRange[1], 
            (pump_status1234 & (4+8)) >> 2);
        this.pumpsCurrentSpeed[2] = this.internalSetPumpSpeed(this.pumpsSpeedRange[2], 
            (pump_status1234 & (16+32)) >> 4);
        this.pumpsCurrentSpeed[3] = this.internalSetPumpSpeed(this.pumpsSpeedRange[3], 
            (pump_status1234 & (64+128)) >> 6);
        // pumps 5,6 are untested by me.
        const pump_status56 = bytes[12];
        this.pumpsCurrentSpeed[4] = this.internalSetPumpSpeed(this.pumpsSpeedRange[4], 
            (pump_status56 & (1+2)));
        this.pumpsCurrentSpeed[5] = this.internalSetPumpSpeed(this.pumpsSpeedRange[5], 
            (pump_status56 & (4+8)) >> 2);
        // Not sure if this circ_pump index or logic is correct.
        this.circulationPumpIsOn = ((bytes[13] & 2) !== 0);
        // The lights are in the low order bites of 'bytes[14]'
        if (this.lightIsOn[0] != undefined) this.lightIsOn[0] = ((bytes[14] & (1+2)) === (1+2));
        if (this.lightIsOn[1] != undefined) this.lightIsOn[1] = ((bytes[14] & (4+8)) === (4+8));
        
        // Believe the following mister/blower/aux lines are correct, but no way to test on my spa

        // On/off for the mister device.
        if (this.misterIsOn != undefined) {
            this.misterIsOn = (bytes[15] & 0x01) != 0;
        }
        // Blowers can have 4 states: off, low, medium, high
        if (this.blowerCurrentSpeed != undefined) {
            this.blowerCurrentSpeed = (bytes[13] & 0x0c) >> 2;
        }
        // The two aux devices:
        if (this.auxIsOn[0] != undefined) this.auxIsOn[0] = (bytes[15] & 0x08) !== 0;
        if (this.auxIsOn[1] != undefined) this.auxIsOn[1] = (bytes[15] & 0x10) !== 0;

        // Bytes 16,17,18,19 - unused or unknown at present
        if (this.tempRangeIsHigh) {
            this.targetTempModeHigh = bytes[20];
        } else {
            this.targetTempModeLow = bytes[20];
        }
        // byte[21] is also set to 8 when we activate any locks. See bytes[9] above for locks
        // We ignore it here, since we capture locks above.
        // byte[22] is set to 64 when we activate 'hold' mode. See bytes[10] above.
        this.hold = (bytes[22] & 64) != 0;
        // byte[22] also apparently contains some further state: 0=Ok, 16=Spa not communicating,
        // 32=startup, 48=priming, 64=hold, 80=panel.

        // Store this for next time
        const oldBytes = this.lastStateBytes;
        this.lastStateBytes = new Uint8Array(bytes);
        // Return true if any values have changed
        if (oldBytes.length != this.lastStateBytes.length) return true;
        for (let i = 0; i < oldBytes.length; i++) {
            // Bytes 3,4 are the time
            if (i != 3 && i != 4) {
                if (oldBytes[i] !== this.lastStateBytes[i]) {
                    return true;
                }
            }
        }
        return false;
    }

    internalSetPumpSpeed(range : number, value: number) {
        if (range === 1) {
            // Spa actually reports 0,2 as the state of a 1-speed pump. We convert that to 0,1
            return value > 0 ? 1 : 0;
        } else {
            return value;
        }
    }

    /**
     * Get the set of accessories on this spa - how many pumps, lights, etc.
     * 
     * @param bytes 1a(=00011010),00,01,90,00,00 on my spa
     */
    interpretControlTypesReply(bytes: Uint8Array) {
        if (this.accurateConfigReadFromSpa) {
            this.log.info("Already discovered Spa configuration.");
            return false;
        }
        // 2 bits per pump. Pumps 5 and 6 are apparently P6xxxxP5 in the second byte
        // Line up all the bites in a row
        let pumpFlags1to6 = bytes[0] + 256 * (bytes[1] & 0x03) + 16 * (bytes[1] & 0xc0);
        let countPumps = 0;
        for (let idx = 0; idx < 6; idx++) {
            // 0 = no such pump, 1 = off/high pump, 2 = off/low/high pump
            this.pumpsSpeedRange[idx] = pumpFlags1to6 & 0x03;
            if (this.pumpsSpeedRange[idx] === 3) {
                this.log.error("3-speed pumps not fully supported.  Please test carefully and report bugs.");
            }
            if (this.pumpsSpeedRange[idx] == 0) {
                this.pumpsCurrentSpeed[idx] = 0;
            } else {
                countPumps++;  
            }
            pumpFlags1to6 >>= 2;
        }
        this.log.info("Discovered", countPumps, "pumps with speeds", this.pumpsSpeedRange);
        const lights = [(bytes[2] & 0x03) != 0,(bytes[2] & 0xc0) != 0];
        // Store 'undefined' if the light doesn't exist. Else store 'false' which will
        // soon be over-ridden with the correct light on/off state.
        this.lightIsOn[0] = lights[0] ? false : undefined;
        this.lightIsOn[1] = lights[1] ? false : undefined;
        const countLights = (lights[0] ? 1 : 0) + (lights[1] ? 1 : 0);

        this.hasCirculationPump = (bytes[3] & 0x80) != 0;
        // 0 if it doesn't exist, else number of speeds
        this.blowerSpeedRange = (bytes[3] & 0x03);
        this.blowerCurrentSpeed = this.blowerSpeedRange > 0 ? 0 : undefined;
        this.misterIsOn = (bytes[4] & 0x30) != 0 ? false : undefined;

        const aux = [(bytes[4] & 0x01) != 0,(bytes[4] & 0x02) != 0];
        this.auxIsOn[0] = aux[0] ? false : undefined;
        this.auxIsOn[1] = aux[1] ? false : undefined;

        this.log.info("Discovered",countLights,"light"+(countLights!=1?"s":""));
        this.log.info("Discovered other components: circulation-pump",this.hasCirculationPump,
            ", blower", this.blowerSpeedRange,", mister",this.misterIsOn,", aux",aux);
        this.accurateConfigReadFromSpa = true;
        this.spaConfigurationKnownCallback();
        // If we got an accurate read of all the components, then declare that
        // something has changed. We typically only ever do this once.
        return true;
    }

    /**
     * Information returned from calls 1-4 here. Results shown below for my Spa.
     * 
     * 1: Filters: 14,00,01,1e,88,00,01,1e
     * - Bytes0-3: Filter start at 20:00, duration 1 hour 30 minutes
     * - Bytes4-7: Filter also start 8:00am (high-order bit says it is on), duration 1 hour 30 minutes
     * 2: 64,e1,24,00,4d,53,34,30,45,20,20,20,01,c3,47,96,36,03,0a,44,00
     * - First three bytes are the software id.  
     * - Bytes 5-12 (4d,53,34,30,45,20,20,20) are the motherboard model in ascii
     *   which is MS40E in this case (SIREV16 is a value reported by another user).
     * - After that comes 1 byte for 'current setup' and then 4 bytes which encode
     * the 'configuration signature'. 
     * 3: Results for various people: 
     * 05,01,32,63,50,68,61,07,41 <- mine
     * 12,11,32,63,50,68,61,03,41 
     * 12,04,32,63,50,68,29,03,41
     * 04,01,32,63,3c,68,08,03,41
     * - No idea?! ' cPha' is the ascii version of my middle 5 bytes - so probably not ascii!
     * 4: Reminders, cleaning cycle length, etc.: 00,85,00,01,01,02,00,00,00,00,00,00,00,00,00,00,00,00
     * - first 01 = temp scale (F or C)
     * - next 01 = time format (12hour or 24hour)
     * - 02 = cleaning cycle length in half hour increments
     * 
     * Mostly we don't choose to use any of the above information at present.
     * 
     * @param id 
     * @param contents 
     */
    interpretControlPanelReply(id: number, contents: Uint8Array) {
        this.log.info("Control Panel reply " + id + ":"+ this.prettify(contents));
        if (id == 1) {
            const filter1start = this.timeToString(contents[0], contents[1]);
            const filter1duration = this.timeToString(contents[2], contents[3]);
            const filter2on = (contents[4] & 0x80) != 0;
            const filter2start = this.timeToString(contents[4]&0x7f, contents[5]);
            const filter2duration = this.timeToString(contents[6], contents[7]);
            this.log.info("First filter time from",filter1start,"for",filter1duration);
            this.log.info("Second filter time", (filter2on ? 'on' : 'off'), 
            "from",filter2start,"for",filter2duration);
        } else if (id == 2) {
            // bytes 0-3 tell us about the version of software running, which we format
            // in the same way as on the spa's screen.
            const softwareID = "M" + contents[0] +"_"+contents[1]+" V"+contents[2]+"." + contents[3];
            // Convert bytes 4-11 into ascii
            let motherboard: string = "";
            contents.slice(4,12).forEach((byte: number) => {
                motherboard += String.fromCharCode(byte);
            });
            // No idea what these really mean, but they are shown on the spa screen
            const currentSetup = contents[12];
            const configurationSignature = Buffer.from(contents.slice(13,17)).toString('hex').toUpperCase();
            // This is most of the information that shows up in the Spa display
            // when you go to the info screen.
            this.log.info("System Model", motherboard);
            this.log.info("SoftwareID (SSID)",softwareID);
            this.log.info("Current Setup",currentSetup);
            this.log.info("Configuration Signature",configurationSignature);
            // Not sure what the last 4 bytes 03-0a-44-00 mean
        }
        // None of the above currently indicate a "change" we need to tell homekit about,
        // so return false
        return false;
    }

    /**
     * 	Get log of faults. Return true if there were faults of relevance which require a 
     *  homekit state change
     */ 
    readFaults(bytes: Uint8Array) {
        const daysAgo = bytes[3];
        const hour = bytes[4];
        const minute = bytes[5];

        const code = bytes[2];
        // This is just the most recent fault.  We could query for others too.
        // (I believe by replacing 0xff in the request with a number), but for our
        // purposes the most recent only is sufficient 
        
        // Set flow to good, but possibly over-ride right below
        this.flow = FLOW_GOOD;

        let message : string;
        let stateChanged = false;

        // Check if there are any new faults and report them.  I've chosen just to do 
        // that for codes 16 and 17.  But potentially any code except 19 (Priming) should
        // be alerted.  And priming is perhaps also useful since it indicates a restart.
        // Would be good to separate codes into ones which require immediate intervention
        // vs ones that might be ok for a few hours or days.

        if (daysAgo > 0) {
            message = "No recent faults. Last fault";
        } else if (code == 16 || code == 28) {
            // These indicate a problem, where the spa and/or heater will temporarily shut 
            // down for 1-15 minutes. These generally indicate
            // the filter needs cleaning/change very soon. Important to alert the user
            // of them.
            this.flow = FLOW_LOW;
            // This state change will also be used to switch the thermostat control accessory into 
            // a state of 'off' when water flow fails.
            message = "Recent, alerted fault found";
            stateChanged = true;
        } else if (code == 17 || code == 27 || code == 30) {
            // These are all serious problems. The spa has been shut down. 
            // Hot tub will stop heating and therefore cool down without a change. 
            // Important to alert the user of them.
            this.flow = FLOW_FAILED;
            // This state change will also be used to switch the thermostat control accessory into 
            // a state of 'off' when water flow fails.
            message = "Recent, alerted fault found";
            stateChanged = true;
        } else {
            message = "Recent, but not alerted fault found:";
        }

        // Store this for next time
        const oldBytes = this.lastFaultBytes;
        this.lastFaultBytes = new Uint8Array(bytes);

        // To avoid annoyance, only log each fault once.
        if (!this.equal(oldBytes, this.lastFaultBytes)) {
            this.log.info(message, daysAgo, "days ago of type", 
            "M0"+code,"=",this.faultCodeToString(code),"with details from log:", 
            "Fault Entries:", bytes[0], ", Num:", bytes[1]+1,
            ", Error code:", "M0"+code, ", Days ago:", daysAgo,
            ", Time:", this.timeToString(hour, minute),
            ", Heat mode:", bytes[6], ", Set temp:", this.internalTemperatureToString(bytes[7]), 
            ", Temp A:", this.internalTemperatureToString(bytes[8]), 
            ", Temp B:", this.internalTemperatureToString(bytes[9]));
        }
        
        return stateChanged;
    }

    equal(one: Uint8Array, two: Uint8Array) {
        if (one.length != two.length) return false;
        for (let i = 0; i < one.length; i++) {
            if (one[i] !== two[i]) {
                return false;
            }
        }
        return true;
    }

    /**
     * All fault codes I've found on the internet, e.g. in balboa spa manuals
     * 
     * @param code 
     */
    faultCodeToString(code: number) {
        if (code == 15) return "sensors may be out of sync";
        if (code == 16) return "the water flow is low";
        if (code == 17) return "the water flow has failed";
        if (code == 19) return "priming (this is not actually a fault - your Spa was recently turned on)"
        if (code == 20) return "the clock has failed";
        if (code == 21) return "the settings have been reset (persistent memory error)";
        if (code == 22) return "program memory failure";
        if (code == 26) return "sensors are out of sync -- call for service";
        if (code == 27) return "the heater is dry";
        if (code == 28) return "the heater may be dry";
        if (code == 29) return "the water is too hot";
        if (code == 30) return "the heater is too hot";
        if (code == 31) return "sensor A fault";
        if (code == 32) return "sensor B fault";
        if (code == 33) return "safety trip - pump suction blockage";
        if (code == 34) return "a pump may be stuck on";
        if (code == 35) return "hot fault";
        if (code == 36) return "the GFCI test failed";
        if (code == 37) return "hold mode activated (this is not actually a fault)";
        return "unknown code - check Balboa spa manuals";
    }
}

