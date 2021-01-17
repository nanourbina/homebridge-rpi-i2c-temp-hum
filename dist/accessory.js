"use strict";
const homebridge_1 = require("homebridge");
const i2c_bus_1 = require("i2c-bus");
/*
 * IMPORTANT NOTICE
 *
 * One thing you need to take care of is, that you never ever ever import anything directly from the "homebridge" module (or the "hap-nodejs" module).
 * The above import block may seem like, that we do exactly that, but actually those imports are only used for types and interfaces
 * and will disappear once the code is compiled to Javascript.
 * In fact you can check that by running `npm run build` and opening the compiled Javascript file in the `dist` folder.
 * You will notice that the file does not contain a `... = require("homebridge");` statement anywhere in the code.
 *
 * The contents of the above import statement MUST ONLY be used for type annotation or accessing things like CONST ENUMS,
 * which is a special case as they get replaced by the actual value and do not remain as a reference in the compiled code.
 * Meaning normal enums are bad, const enums can be used.
 *
 * You MUST NOT import anything else which remains as a reference in the code, as this will result in
 * a `... = require("homebridge");` to be compiled into the final Javascript code.
 * This typically leads to unexpected behavior at runtime, as in many cases it won't be able to find the module
 * or will import another instance of homebridge causing collisions.
 *
 * To mitigate this the {@link API | Homebridge API} exposes the whole suite of HAP-NodeJS inside the `hap` property
 * of the api object, which can be acquired for example in the initializer function. This reference can be stored
 * like this for example and used to access all exported variables and classes from HAP-NodeJS.
 */
let hap;
//const i2c = require('i2c-bus');
const AHTX0_I2CADDR_DEFAULT = 0x38; // Default I2C address
const AHTX0_CMD_CALIBRATE = 0xE1; // Calibration command
const AHTX0_CMD_TRIGGER = 0xAC; // Trigger reading command
const AHTX0_CMD_SOFTRESET = 0xBA; // Soft reset command
const AHTX0_STATUS_BUSY = 0x80; // Status bit for busy
const AHTX0_STATUS_CALIBRATED = 0x08; // Status bit for calibrated
class AHTx0 {
    constructor(busNumber, i2cAddress) {
        this.busNumber = busNumber;
        this.address = i2cAddress;
        this.dataBuffer = Buffer.alloc(5);
        this.i2cBus = i2c_bus_1.openSync(busNumber);
        var addresses = this.i2cBus.scanSync(i2cAddress);
        if (addresses[0] != i2cAddress)
            throw new Error('I2C Device not found at default address: ' + i2cAddress);
        this.i2cBus.closeSync();
    }
    open() {
        this.i2cBus = i2c_bus_1.openSync(this.busNumber);
        this._reset();
        if (!this._calibrate())
            throw new Error('Could not calibrate AHT10 device');
    }
    close() {
        this.i2cBus.closeSync();
    }
    _sleep(millis) {
        return (new Promise(resolve => setTimeout(resolve, millis)));
    }
    _reset() {
        this.i2cBus.sendByteSync(this.address, AHTX0_CMD_SOFTRESET);
        this._sleep(20);
    }
    _calibrate() {
        const registerNo = AHTX0_CMD_CALIBRATE;
        const registerData = 0x0008;
        this.i2cBus.writeWordSync(this.address, registerNo, registerData);
        while (this._status() & AHTX0_STATUS_BUSY) {
            this._sleep(10);
        }
        if ((this._status() & AHTX0_STATUS_CALIBRATED))
            return true;
        else
            return false;
    }
    _status() {
        return this.i2cBus.receiveByteSync(this.address);
    }
    _humidity(data) {
        let humidity = (data[1] << 12) | (data[2] << 4) | (data[3] >> 4);
        return (humidity * 100) / 0x100000;
    }
    _temperature(data) {
        let temp = ((data[3] & 0xF) << 16) | (data[4] << 8) | data[5];
        return ((temp * 200.0) / 0x100000) - 50;
    }
    _readData() {
        const registerNo = AHTX0_CMD_TRIGGER;
        const registerData = 0x0033;
        this.i2cBus.writeWordSync(this.address, registerNo, registerData);
        while (this._status() & AHTX0_STATUS_BUSY) {
            this._sleep(10);
        }
        this.i2cBus.readI2cBlockSync(this.address, AHTX0_CMD_TRIGGER, 5, this.dataBuffer);
        return this.dataBuffer;
    }
    relative_humidity() {
        let data = this._readData();
        return this._humidity(data);
    }
    temperature() {
        let data = this._readData();
        console.log(data);
        return this._temperature(data);
    }
}
class RPITemperatureAndHumidity {
    constructor(log, config, api) {
        this.temperature = -273;
        this.relHumidity = 0;
        this.log = log;
        this.name = config.name;
        this.manufacturer = config.manufacturer || "ASAIR";
        this.model = config.model || "AHT10";
        this.serial = config.serial || "18981898";
        this.aht10 = new AHTx0(1, AHTX0_I2CADDR_DEFAULT);
        this.informationService = new hap.Service.AccessoryInformation()
            .setCharacteristic(hap.Characteristic.Manufacturer, this.manufacturer)
            .setCharacteristic(hap.Characteristic.Model, this.model)
            .setCharacteristic(hap.Characteristic.SerialNumber, this.serial);
        this.temperatureService = new homebridge_1.Service.TemperatureSensor(this.name);
        this.temperatureService.getCharacteristic(hap.Characteristic.CurrentTemperature)
            .on("get" /* GET */, (callback) => {
            this.aht10.open();
            this.temperature = this.aht10.temperature();
            this.aht10.close();
            log.info("Current temperature returned: " + (this.temperature));
            callback(undefined, this.temperature);
        });
        this.humidityService = new homebridge_1.Service.HumiditySensor(this.name);
        this.humidityService.getCharacteristic(hap.Characteristic.CurrentRelativeHumidity)
            .on("get" /* GET */, (callback) => {
            this.aht10.open();
            this.relHumidity = this.aht10.relative_humidity();
            this.aht10.close();
            log.info("Current relative humidity returned: " + (this.relHumidity));
            callback(undefined, this.relHumidity);
        });
        log.info("RPITemperatureAndHumidity finished initializing!");
    }
    /*
     * This method is optional to implement. It is called when HomeKit ask to identify the accessory.
     * Typical this only ever happens at the pairing process.
     */
    identify() {
        this.log("Identify!");
    }
    /*
     * This method is called directly after creation of this instance.
     * It should return all services which should be added to the accessory.
     */
    getServices() {
        return [
            this.informationService,
            this.temperatureService,
            this.humidityService
        ];
    }
}
module.exports = (api) => {
    hap = api.hap;
    api.registerAccessory("homebridge-rpi-i2c-temp-hum", RPITemperatureAndHumidity);
};
//# sourceMappingURL=accessory.js.map