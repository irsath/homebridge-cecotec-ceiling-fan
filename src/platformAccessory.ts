import { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import { HomebridgeCreateCeilingFan } from './platform';
import TuyAPI from 'tuyapi';
import TuyaDevice, { DPSObject } from 'tuyapi';

export class CeilingFanAccessory {
  private fanService!: Service;
  private lightService!: Service;

  private state = {
    fanStatus: 0,
    rotationDirection: 0,
    rotationSpeedStep: 1,
    swingMode: 0,
    lightOn: false,
    lightBrightness: 100,
  };

  constructor(
    private readonly platform: HomebridgeCreateCeilingFan,
    private readonly accessory: PlatformAccessory,
  ) {
    const device = new TuyAPI({
      id: accessory.context.device.id,
      key: accessory.context.device.key,
      ip: accessory.context.device.ip,
      version: accessory.context.device.version,
      issueRefreshOnConnect: true,
    });


    device.on('disconnected', () => {
      this.platform.log.info('Disconnected... Try to connect');
      this.connect(device);
    });
    device.on('error', error => {
      this.platform.log.info('Error :', error);
      this.platform.log.info('Try to connect');
      this.connect(device);
    });


    // Information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'CECOTEC')
      .setCharacteristic(this.platform.Characteristic.Model, 'Ceiling Fan')
      .setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.device.id);

    // Fan
    this.fanService = this.accessory.getService(this.platform.Service.Fanv2) || this.accessory.addService(this.platform.Service.Fanv2);
    this.fanService.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name);


    // Fan state
    this.fanService.getCharacteristic(this.platform.Characteristic.Active)
      .onSet(async (value: CharacteristicValue) => {
        this.state.fanStatus = value.valueOf() as number;
        await device.set({
          dps: 1,
          set: this.state.fanStatus === this.platform.Characteristic.Active.ACTIVE ? true : false,
          shouldWaitForResponse: false,
        });
      })
      .onGet(() => this.state.fanStatus);

    const stateHook = (data: DPSObject) => {
      const isActive = data.dps['1'] as boolean | undefined;
      if (isActive !== undefined) {
        this.state.fanStatus = isActive ? this.platform.Characteristic.Active.ACTIVE : this.platform.Characteristic.Active.INACTIVE;
        this.platform.log.info('Update: Fan status ', isActive ? 'on' : 'off');
        this.fanService.updateCharacteristic(this.platform.Characteristic.Active, this.state.fanStatus);
      }
    };
    device.on('dp-refresh', stateHook);
    device.on('data', stateHook);

    // Fan rotation
    this.fanService.getCharacteristic(this.platform.Characteristic.RotationDirection)
      .onSet(async (value: CharacteristicValue) => {
        this.state.rotationDirection = value.valueOf() as number;
        await device.set({
          dps: 4,
          set: this.state.rotationDirection === this.platform.Characteristic.RotationDirection.CLOCKWISE ? 'forward' : 'reverse',
          shouldWaitForResponse: false,
        });
      })
      .onGet(() => this.state.rotationDirection);

    const rotationHook = (data: DPSObject) => {
      const rotation = data.dps['4'] as string | undefined;
      if (rotation !== undefined) {
        this.state.rotationDirection = rotation === 'forward'
          ? this.platform.Characteristic.RotationDirection.CLOCKWISE
          : this.platform.Characteristic.RotationDirection.COUNTER_CLOCKWISE;
        this.platform.log.info('Update: Fan rotation ',
          this.state.rotationDirection === this.platform.Characteristic.RotationDirection.CLOCKWISE ? 'clockwise' : 'counter-clockwise');
        this.fanService.updateCharacteristic(this.platform.Characteristic.RotationDirection, this.state.rotationDirection);
      }
    };
    device.on('dp-refresh', rotationHook);
    device.on('data', rotationHook);

    // Fan speed
    this.fanService.getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .onSet(async (value: CharacteristicValue) => {
        const speedPercent = value.valueOf() as number;
        const speedStep = this.toStep(speedPercent);
        this.state.rotationSpeedStep = speedStep;

        await device.set({ dps: 4, set: speedStep, shouldWaitForResponse: false });

        if (speedPercent === 0 && this.state.fanStatus === this.platform.Characteristic.Active.ACTIVE) {
          this.state.fanStatus = this.platform.Characteristic.Active.INACTIVE;
          await device.set({ dps: 1, set: false, shouldWaitForResponse: false });
        } else if (speedPercent > 0 && this.state.fanStatus === this.platform.Characteristic.Active.INACTIVE) {
          this.state.fanStatus = this.platform.Characteristic.Active.ACTIVE;
        }
      })
      .onGet(() => this.state.rotationSpeedStep)
      .setProps({});

    const speedHook = (data: DPSObject) => {
      const speed = data.dps['3'] as number | undefined;
      if (speed !== undefined) {
        const percent = Math.floor(100 / 6 * speed);
        this.state.rotationSpeedStep = speed;
        this.platform.log.info('Update: Fan speed (', percent, '% | speed: ', speed, ')');
        this.fanService.updateCharacteristic(this.platform.Characteristic.RotationSpeed, percent);
      }
    };
    device.on('dp-refresh', speedHook);
    device.on('data', speedHook);

    // Swing mode
    this.fanService.getCharacteristic(this.platform.Characteristic.SwingMode)
      .onSet(async (value: CharacteristicValue) => {
        const swingMode = value.valueOf() as number;
        this.state.swingMode = swingMode;

        await device.set({
          dps: 2,
          set: swingMode === this.platform.Characteristic.SwingMode.SWING_ENABLED ? 'sleep' : 'nature',
          shouldWaitForResponse: false,
        });
      })
      .onGet(() => this.state.rotationSpeedStep)
      .setProps({});

    const swingHook = (data: DPSObject) => {
      const swing = data.dps['2'] as string | undefined;
      if (swing !== undefined) {
        this.state.swingMode =
          swing === 'sleep' ? this.platform.Characteristic.SwingMode.SWING_ENABLED : this.platform.Characteristic.SwingMode.SWING_DISABLED;
        this.platform.log.info('Update: Fan swing ',
          this.state.swingMode === this.platform.Characteristic.SwingMode.SWING_ENABLED ? 'enabled' : 'disabled');
        this.fanService.updateCharacteristic(this.platform.Characteristic.SwingMode, this.state.swingMode);
      }
    };
    device.on('dp-refresh', swingHook);
    device.on('data', swingHook);


    if (accessory.context.device.hasLight) {
      // Fan Light
      this.lightService = this.accessory.getService(this.platform.Service.Lightbulb)
        || this.accessory.addService(this.platform.Service.Lightbulb);
      this.lightService.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name);
      this.lightService.getCharacteristic(this.platform.Characteristic.On)
        .onSet(async (value: CharacteristicValue) => {
          this.state.lightOn = value.valueOf() as boolean;
          await device.set({ dps: 15, set: this.state.lightOn, shouldWaitForResponse: false });
          await device.refresh({});
        })
        .onGet(() => this.state.lightOn);

      const lightStateHook = (data: DPSObject) => {
        const isOn = data.dps['15'] as boolean | undefined;
        if (isOn !== undefined) {
          this.state.lightOn = isOn;
          this.platform.log.info('Update: Light ', this.state.lightOn ? 'on' : 'off');
          this.lightService.updateCharacteristic(this.platform.Characteristic.On, this.state.lightOn);
        }
      };
      device.on('dp-refresh', lightStateHook);
      device.on('data', lightStateHook);

      // Fan Light Brightness
      this.lightService.getCharacteristic(this.platform.Characteristic.Brightness)
        .onSet(async (value: CharacteristicValue) => {
          this.state.lightBrightness = value.valueOf() as number;
          await device.set({ dps: 16, set: this.state.lightBrightness, shouldWaitForResponse: false });

          if (this.state.lightBrightness === 0 && this.state.lightOn) {
            await device.set({ dps: 15, set: false, shouldWaitForResponse: false });
          } else if (this.state.lightBrightness > 0 && !this.state.lightOn) {
            await device.set({ dps: 15, set: true, shouldWaitForResponse: false });
          }
        })
        .onGet(() => this.state.lightBrightness);

      const lightBrightnessHook = (data: DPSObject) => {
        const brightness = data.dps['16'] as number | undefined;
        if (brightness !== undefined) {
          this.state.lightBrightness = brightness;
          this.platform.log.info('Update: Brightness ', this.state.lightBrightness, '%');
          this.lightService.updateCharacteristic(this.platform.Characteristic.Brightness, this.state.lightBrightness);
        }
      };
      device.on('dp-refresh', lightBrightnessHook);
      device.on('data', lightBrightnessHook);
    }

    this.connect(device);
  }

  async connect(device: TuyaDevice) {
    try {
      this.platform.log.info('Connecting...');
      await device.find();
      await device.connect();
      this.platform.log.info('Connected');
    } catch (e) {
      this.platform.log.info('Connection failed', e);
      this.platform.log.info('Retry in 1 minute');
      setTimeout(() => this.connect(device), 60000);
    }
  }


  toStep(percent: number) {
    const validSpeeds = [0, 1, 2, 3, 4, 5, 6];
    const stepIndex = Math.floor(percent / 16.67); // 100 / 6 = 16.67
    return validSpeeds[stepIndex];
  }
}