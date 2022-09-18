import { CharacteristicEventTypes } from 'homebridge';
import type { Service, PlatformAccessory, CharacteristicGetCallback} from 'homebridge';

import { SpaHomebridgePlatform } from './platform';
import { VERSION } from './settings';
import { FLOW_FAILED, FLOW_LOW } from './spaClient';

/**
 * WaterFlowProblemAccessory
 * 
 * We create a water flow monitor as a Homekit LeakSensor to tell us if there's a problem 
 * with the water flow in the heating system of the hot tub.  At least in my experience
 * this is the most common, easily resolvable, but annoying problem that can occur. The
 * earlier you are notified (hence Home integration), the less troubling it is.
 */
export class WaterFlowProblemAccessory {
  private service: Service;

  constructor(
    private readonly platform: SpaHomebridgePlatform,
    private readonly accessory: PlatformAccessory,
  ) {

    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Balboa')
      .setCharacteristic(this.platform.Characteristic.Model, this.platform.name)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, VERSION);

    // get the LeakSensor service if it exists, otherwise create a new LeakSensor service
    // you can create multiple services for each accessory
    this.service = this.accessory.getService(this.platform.Service.LeakSensor) ?? this.accessory.addService(this.platform.Service.LeakSensor);

    // set the service name, this is what is displayed as the default name on the Home app
    // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.
    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name);

    // each service must implement at-minimum the "required characteristics" for the given service type
    // see https://developers.homebridge.io/#/service/LeakSensor

    this.service.getCharacteristic(this.platform.Characteristic.LeakDetected)
    .on(CharacteristicEventTypes.GET, this.handleLeakDetectedGet.bind(this));
    this.service.getCharacteristic(this.platform.Characteristic.StatusFault)
    .on(CharacteristicEventTypes.GET, this.handleFaultDetectedGet.bind(this));

  }

  handleLeakDetectedGet(callback: CharacteristicGetCallback) {
    if (!this.platform.isCurrentlyConnected()) {
      callback(this.platform.connectionProblem);
    } else {
      const flowState = this.platform.spa!.getFlowState();
      this.platform.log.debug('Get Flow State <-', flowState);
      callback(null, flowState === FLOW_FAILED);
    }
  }

  handleFaultDetectedGet(callback: CharacteristicGetCallback) {
    if (!this.platform.isCurrentlyConnected()) {
      callback(this.platform.connectionProblem);
    } else {
      const flowState = this.platform.spa!.getFlowState();
      this.platform.log.debug('Get Flow Fault <-', flowState);
      callback(null, flowState === FLOW_LOW);
    }
  }

  spaConfigurationKnown() {
    // nothing to do
  }

  // If Spa state has changed, for example using manual controls on the spa, then we must update Homekit.
  updateCharacteristics() {
    if (!this.platform.isCurrentlyConnected()) {
      this.service.getCharacteristic(this.platform.Characteristic.LeakDetected).updateValue(this.platform.connectionProblem);
      this.service.getCharacteristic(this.platform.Characteristic.StatusFault).updateValue(this.platform.connectionProblem);
      return;
    }
    const flowState = this.platform.spa!.getFlowState();
    this.service.getCharacteristic(this.platform.Characteristic.LeakDetected).updateValue(flowState === FLOW_FAILED);
    this.service.getCharacteristic(this.platform.Characteristic.StatusFault).updateValue(flowState === FLOW_LOW);
  }

}
