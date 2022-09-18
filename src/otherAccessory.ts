import { CharacteristicEventTypes } from 'homebridge';
import type { Service, PlatformAccessory, CharacteristicValue, CharacteristicSetCallback, CharacteristicGetCallback} from 'homebridge';

import { SpaHomebridgePlatform } from './platform';
import { VERSION } from './settings';

/**
 * OtherAccessory
 * 
 * Control mister, aux1, aux2 (if they exist on your spa)
 */
export class OtherAccessory {
  private service: Service;

  constructor(
    private readonly platform: SpaHomebridgePlatform,
    private readonly accessory: PlatformAccessory,
    private readonly type : number // 0 = mister, 1 = aux1, 2 = aux2
  ) {

    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Balboa')
      .setCharacteristic(this.platform.Characteristic.Model, this.platform.name)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, VERSION);

    // get the Switch service if it exists, otherwise create a new Switch service
    // you can create multiple services for each accessory
    this.service = this.accessory.getService(this.platform.Service.Switch) ?? this.accessory.addService(this.platform.Service.Switch);

    // set the service name, this is what is displayed as the default name on the Home app
    // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.
    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name);

    // each service must implement at-minimum the "required characteristics" for the given service type
    // see https://developers.homebridge.io/#/service/Switch

    // register handlers for the On/Off Characteristic
    this.service.getCharacteristic(this.platform.Characteristic.On)
      .on(CharacteristicEventTypes.SET, this.setOn.bind(this))                // SET - bind to the `setOn` method below
      .on(CharacteristicEventTypes.GET, this.getOn.bind(this));               // GET - bind to the `getOn` method below
  }

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, turning on a Light bulb.
   */
  setOn(value: CharacteristicValue, callback: CharacteristicSetCallback) {
    if (!this.platform.isCurrentlyConnected()) {
      callback(this.platform.connectionProblem);
      return;
    }
    // Turn the item on or off
    if (this.type === 0) {
      this.platform.spa!.setMisterState(value as boolean);
      this.platform.log.debug('Set Mister On ->', value);
    } else {
      this.platform.spa!.setAuxState(this.type, value as boolean);
      this.platform.log.debug('Set Aux', this.type, 'On ->', value);
    }

    callback(null);
  }

  spaConfigurationKnown() {
    if (this.type === 0) {
      if (this.platform.spa!.getIsMisterOn() == undefined) {
        // The mister doesn't exist.
        this.platform.log.warn("Nonexistent mister accessory declared.");
      }
    } else {
      if (this.platform.spa!.getIsAuxOn(this.type) == undefined) {
        // This aux device doesn't exist.
        this.platform.log.warn("Nonexistent aux", this.type, "accessory declared.");
      }
    }
  }

  // If Spa state has changed, for example using manual controls on the spa, then we must update Homekit.
  updateCharacteristics() {
    if (!this.platform.isCurrentlyConnected()) {
      this.service.getCharacteristic(this.platform.Characteristic.On).updateValue(this.platform.connectionProblem);
      return;
    }
    if (this.type === 0) {
      const isOn = this.platform.spa!.getIsMisterOn();
      if (isOn != undefined) {
        this.platform.log.debug('Mister updating to',isOn ? 'On' : 'Off');
        this.service.getCharacteristic(this.platform.Characteristic.On).updateValue(isOn);
      }
    } else {
      const isOn = this.platform.spa!.getIsAuxOn(this.type);
      if (isOn != undefined) {
        this.platform.log.debug('Aux',this.type,'updating to',isOn ? 'On' : 'Off');
        this.service.getCharacteristic(this.platform.Characteristic.On).updateValue(isOn);
      }
    }
  }
  
  /**
   * Handle the "GET" requests from HomeKit
   * These are sent when HomeKit wants to know the current state of the accessory, for example, checking if a Light bulb is on.
   * 
   * GET requests should return as fast as possbile. A long delay here will result in
   * HomeKit being unresponsive and a bad user experience in general.
   * 
   * If your device takes time to respond you should update the status of your device
   * asynchronously instead using the `updateCharacteristic` method instead.

   * @example
   * this.service.updateCharacteristic(this.platform.Characteristic.On, true)
   */
  getOn(callback: CharacteristicGetCallback) {
    if (!this.platform.isCurrentlyConnected()) {
      callback(this.platform.connectionProblem);
    } else {
      let isOn : boolean | undefined;
      if (this.type === 0) {
        isOn = this.platform.spa!.getIsMisterOn();
        this.platform.log.debug('Get Mister On <-', isOn, this.platform.status());
      } else {
        isOn = this.platform.spa!.getIsAuxOn(this.type);
        this.platform.log.debug('Get Aux', this.type, 'On <-', isOn, this.platform.status());
      }
      callback(null, isOn);
    }
  }

}
