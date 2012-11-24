var REOPEN_INTERVAL = 2000;
var SerialPort = require("serialport").SerialPort;
var serial;
function openSerial() {
    console.log('openSerial');
    switchState(null);
    try {
	serial = new SerialPort("/dev/ttyACM0");
    } catch (e) {
	console.error(e.stack || e);
	setTimeout(openSerial, REOPEN_INTERVAL);
	return;
    }
    serial.on('data', function(data) {
	switchState(data.toString()[0]);
    });
    serial.on('end', openSerial);
    serial.on('error', function() {
	setTimeout(openSerial, REOPEN_INTERVAL);
    });
    setTimeout(function() {
	try {
	    /* Get */
	    serial.write("?");
	} catch (e) {
	    console.error(e.stack || e);
	    setTimeout(openSerial, REOPEN_INTERVAL);
	    return;
	}
    }, 1000);
}

process.nextTick(openSerial);


module.exports = new process.EventEmitter();
module.exports.state = null;
function switchState(state) {
    if (module.exports.state !== state) {
	module.exports.state = state;
	module.exports.emit('switch', state);
    }
}

/* Start directly for debugging */
if (process.argv[1] == __filename)
    module.exports.on('switch', function() {
	console.log('switch', arguments);
    });



