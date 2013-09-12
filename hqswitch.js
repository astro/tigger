var fs = require('fs');
function getGpio(n) {
	return parseInt(fs.readFileSync("/sys/class/gpio/gpio"+n+"/value"), 10);
}
function getGpios() {
	if (getGpio(23))
		switchState(1);
	else if (getGpio(24))
		switchState(2);
	else
		switchState(0);
}
setInterval(getGpios, 100);


module.exports = new process.EventEmitter();
module.exports.state = null;
function switchState(state) {
    if (module.exports.state !== state) {
	module.exports.state = state;
	console.log("switch", state);
	module.exports.emit('switch', state);
    }
}

/* Start directly for debugging */
if (process.argv[1] == __filename)
    module.exports.on('switch', function() {
	console.log('switch', arguments);
    });



