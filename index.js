var instance_skel = require('../../instance_skel');
let os            = require('os');
var exec          = (require('child_process')).exec;
var debug;
var log;

var interfaces = [];


function instance(system, id, config) {
	var self = this;

	self.model = 0;
	self.states = {};
	self.system = system;
	self.inputs = {};

	self.instance_errors = 0;
	self.instance_warns = 0;
	self.instance_oks = 0;

	self.system.on('instance_errorcount', function(errcount) {

		self.instance_errors = errcount[2];
		self.instance_warns = errcount[1];
		self.instance_oks = errcount[0];

		self.setVariable('instance_errors', self.instance_errors);
		self.setVariable('instance_warns', self.instance_warns);
		self.setVariable('instance_oks', self.instance_oks);

		self.checkFeedbacks('instance_status');
	});

	self.time_interval = setInterval(function() {
		const now = new Date();
		const hh = (`0${now.getHours()}`).slice(-2);
		const mm = (`0${now.getMinutes()}`).slice(-2);
		const ss = (`0${now.getSeconds()}`).slice(-2);
		const month = (`0${now.getMonth()+1}`).slice(-2);
		const day = (`0${now.getDate()}`).slice(-2);
		const hhmm = hh + ":" + mm;
		const hhmmss = hhmm + ":" + ss;
		self.setVariable('date_y', now.getFullYear());
		self.setVariable('date_m', month);
		self.setVariable('date_d', day);
		self.setVariable('time_hms', hhmmss);
		self.setVariable('time_hm', hhmm);
		self.setVariable('time_h', hh);
		self.setVariable('time_m', mm);
		self.setVariable('time_s', ss);
	}, 1000);

	// super-constructor
	instance_skel.apply(this, arguments);

	// Version 1 = from 15 to 32 keys config
	self.addUpgradeScript(self.upgrade15to32.bind(self));

	return self;
}

instance.prototype.init = function() {
	var self = this;

	debug = self.debug;
	log = self.log;

	self.callbacks = {};
	self.instances = {};
	self.active = {};
	self.pages = {};
	self.pageHistory = {};

	self.CHOICES_INSTANCES = [];
	self.CHOICES_SURFACES = [];
	self.CHOICES_PAGES = [];
	self.CHOICES_BANKS = [ { label: 'This button', id: 0 } ];

	for (var bank = 1; bank <= global.MAX_BUTTONS; bank++) {
		self.CHOICES_BANKS.push({ label: bank, id: bank });
	}

	self.BUTTON_ACTIONS = [
		'button_pressrelease', 'button_press','button_release','button_text','textcolor','bgcolor','panic_one'
	];

	self.pages_getall();
	self.addSystemCallback('page_update', self.pages_update.bind(self));

	self.devices_getall();
	self.addSystemCallback('devices_list', self.devices_list.bind(self));

	self.instance_save();
	self.addSystemCallback('instance_save', self.instance_save.bind(self));

	self.status(self.STATE_OK);

	self.checkFeedbacks();
	self.update_variables();

	self.bind_ip_get();
	self.addSystemCallback('ip_rebind', self.bind_ip_get.bind(self));
};

instance.prototype.upgrade15to32 = function(config, actions) {
	var self = this;

	for (var i = 0; i < actions.length; ++i) {
		var action = actions[i];

		if (action.options !== undefined && action.options.page !== undefined && action.options.bank !== undefined) {
			var bank = parseInt(action.options.bank);

			self.system.emit('bank_get15to32', bank, function (_bank) {
				action.options.bank = _bank;
			});
		}
	}
};

instance.prototype.bind_ip_get = function() {
	var self = this;

	self.system.emit('config_get', 'bind_ip', function (bind_ip) {
		self.setVariable('bind_ip', bind_ip);
	});

};

instance.prototype.pages_getall = function() {
	var self = this;

	self.system.emit('get_page', function (pages) {
		self.pages = pages;
	});
};

instance.prototype.pages_update = function() {
	var self = this;

	// Update dropdowns
	self.init_actions();
};

instance.prototype.devices_list = function(list) {
	var self = this;

	self.devices = list;
	self.init_actions();
};

instance.prototype.devices_getall = function() {
	var self = this;

	self.system.emit('devices_list_get', function (list) {
		self.devices = list;
	});
};

instance.prototype.instance_save = function() {
	var self = this;

	self.system.emit('instance_getall', self.instance_getall.bind(self));
};

instance.prototype.instance_getall = function(instances, active) {
	var self = this;
	self.instances = instances;
	self.active = active;
	self.CHOICES_INSTANCES.length = 0;

	for (var key in self.instances) {
		if (self.instances[key].label !== 'internal') {
			self.CHOICES_INSTANCES.push({ label: self.instances[key].label, id: key });
		}
	}

	self.init_actions();
};

instance.prototype.addSystemCallback = function(name, cb) {
	var self = this;

	if (self.callbacks[name] === undefined) {
		self.callbacks[name] = cb.bind(self);
		self.system.on(name, cb);
	}
};

instance.prototype.removeAllSystemCallbacks = function () {
	var self = this;

	for (var key in self.callbacks) {
		self.system.removeListener(key, self.callbacks[key]);
		delete self.callbacks[key];
	}
};

instance.prototype.updateConfig = function(config) {
	var self = this;
	self.config = config;

};

// Return config fields for web config
instance.prototype.config_fields = function () {
	var self = this;

	return [
		{
			type: 'text',
			id: 'info',
			width: 12,
			label: 'Information',
			value: 'This module exposes internal functions of companion and does not have any configuration options'
		}
	];
};

// When module gets deleted
instance.prototype.destroy = function() {
	var self = this;
	if (self.time_interval) {
		clearInterval(self.time_interval);
	}
	self.removeAllSystemCallbacks();
};

instance.prototype.init_actions = function(system) {
	var self = this;

	self.CHOICES_SURFACES.length = 0;
	self.CHOICES_SURFACES.push({
		label: 'Current surface',
		id: 'self'
	});
	for (var i = 0; i < self.devices.length; ++i) {
		self.CHOICES_SURFACES.push({
			label: self.devices[i].type + ' (' + self.devices[i].serialnumber + ')',
			id: self.devices[i].serialnumber
		});
	}

	self.CHOICES_PAGES = [ { label: 'This page', id: 0 } ];

	for (var page in self.pages) {
		var name = page;

		if (self.pages[page].name !== undefined && self.pages[page].name != 'PAGE') {
			name += ' (' + self.pages[page].name + ')';
		}
		self.CHOICES_PAGES.push({
			label: name,
			id: page
		});
	}

	actions = {
		'instance_control': {
			label: 'Enable or disable instance',
			options: [
				{
					 type: 'dropdown',
					 label: 'Instance',
					 id: 'instance_id',
					 default: self.CHOICES_INSTANCES.length > 0 ? self.CHOICES_INSTANCES[0].id : undefined,
					 choices: self.CHOICES_INSTANCES
				},
				{
					 type: 'dropdown',
					 label: 'Enable',
					 id: 'enable',
					 default: 'true',
					 choices: self.CHOICES_YESNO_BOOLEAN
				}
			]
		},
		'set_page': {
			label: 'Set surface with s/n to page',
			options: [
				{
					type: 'dropdown',
					label: 'Surface / controller',
					id: 'controller',
					default: 'self',
					choices: self.CHOICES_SURFACES
				},
				{
					type: 'dropdown',
					label: 'Page',
					id: 'page',
					default: '1',
					choices: [{ id: 'back', label: 'Back' }, { id: 'forward', label: 'Forward' }, ...self.CHOICES_PAGES]
				}
			]
		},
		'set_page_byindex': {
			label: 'Set surface with index to page',
				options: [
				{
					type: 'number',
					label: 'Surface / controller',
					id: 'controller',
					tooltip: 'Emulator is 0, all other controllers in order of type and serial-number',
					min: 0,
					max: 100,
					default: 0,
					required: true,
					range: false
				},
				{
					type: 'dropdown',
					label: 'Page',
					id: 'page',
					default: '1',
					choices: [{ id: 'back', label: 'Back' }, { id: 'forward', label: 'Forward' }, ...self.CHOICES_PAGES]
				}
			]
		},
		'lockout_device': {
			label: 'Trigger a device to lockout immediately.',
			options: [
				{
					type: 'dropdown',
					label: 'Surface / controller',
					id: 'controller',
					default: 'self',
					choices: self.CHOICES_SURFACES
				}
			]
		},
		'unlockout_device': {
			label: 'Trigger a device to unlock immediately.',
			options: [
				{
					type: 'dropdown',
					label: 'Surface / controller',
					id: 'controller',
					default: 'self',
					choices: self.CHOICES_SURFACES
				}
			]
		},
		'exec': {
			label: 'Run shell path (local)',
			options: [
				{
					type: 'textinput',
					label: 'Path',
					id: 'path',
				},
				{
					type: 'number',
					label: 'Timeout (ms, between 500 and 20000)',
					id: 'timeout',
					default: 5000,
					min: 500,
					max: 20000,
					required: true
				}
			]
		},
		'lockout_all': {
			label: 'Trigger all devices to lockout immediately.'
		},
		'unlockout_all': {
			label: 'Trigger all devices to unlock immediately.'
		},
		'inc_page': {
			label: 'Increment page number',
			options: [
				{
					type: 'dropdown',
					label: 'Surface / controller',
					id: 'controller',
					default: 'self',
					choices: self.CHOICES_SURFACES
				}
			]
		},
		'dec_page': {
			label: 'Decrement page number',
			options: [
				{
					type: 'dropdown',
					label: 'Surface / controller',
					id: 'controller',
					default: 'self',
					choices: self.CHOICES_SURFACES
				}
			]
		},

		'button_pressrelease': {
			label: 'Button press and release',
			options: [
				{
					type: 'dropdown',
					label: 'Page',
					tooltip: 'What page is the button on?',
					id: 'page',
					default: '1',
					choices: self.CHOICES_PAGES
				},
				{
					type: 'dropdown',
					label: 'Bank',
					tooltip: 'Choosing This Button will ignore choice of Page',
					id: 'bank',
					default: '1',
					choices: self.CHOICES_BANKS
				}
			]
		},

		'button_press': {
			label: 'Button Press',
			options: [
				{
					type: 'dropdown',
					label: 'Page',
					tooltip: 'What page is the button on?',
					id: 'page',
					default: '1',
					choices: self.CHOICES_PAGES
				},
				{
					type: 'dropdown',
					label: 'Bank',
					tooltip: 'Choosing This Button will ignore choice of Page',
					id: 'bank',
					default: '1',
					choices: self.CHOICES_BANKS
				}
			]
		},

		'button_release': {
			label: 'Button Release',
			options: [
				{
					type: 'dropdown',
					label: 'Page',
					tooltip: 'What page is the button on?',
					id: 'page',
					default: '1',
					choices: self.CHOICES_PAGES
				},
				{
					type: 'dropdown',
					label: 'Bank',
					tooltip: 'Choosing This Button will ignore choice of Page',
					id: 'bank',
					default: '1',
					choices: self.CHOICES_BANKS
				}
			]
		},

		'button_text': {
			label: 'Button Text',
			options: [
				{
					type: 'textinput',
					label: 'Button Text',
					id: 'label',
					default: ''
				},
				{
					type: 'dropdown',
					label: 'Page',
					tooltip: 'What page is the button on?',
					id: 'page',
					default: '1',
					choices: self.CHOICES_PAGES
				},
				{
					type: 'dropdown',
					label: 'Bank',
					tooltip: 'Choosing This Button will ignore choice of Page',
					id: 'bank',
					default: '1',
					choices: self.CHOICES_BANKS
				}
			]
		},

		'textcolor': {
			label: 'Button Text Color',
			options: [
				{
					type: 'colorpicker',
					label: 'Text Color',
					id: 'color',
					default: '0'
				},
				{
					type: 'dropdown',
					label: 'Page',
					tooltip: 'What page is the button on?',
					id: 'page',
					default: '1',
					choices: self.CHOICES_PAGES
				},
				{
					type: 'dropdown',
					label: 'Bank',
					tooltip: 'Choosing This Button will ignore choice of Page',
					id: 'bank',
					default: '1',
					choices: self.CHOICES_BANKS
				}
			]
		},

		'bgcolor': {
			label: 'Button Background Color',
			options: [
				{
					type: 'colorpicker',
					label: 'Background Color',
					id: 'color',
					default: '0'
				},
				{
					type: 'dropdown',
					label: 'Page',
					tooltip: 'What page is the button on?',
					id: 'page',
					default: '1',
					choices: self.CHOICES_PAGES
				},
				{
					type: 'dropdown',
					label: 'Bank',
					tooltip: 'Choosing This Button will ignore choice of Page',
					id: 'bank',
					default: '1',
					choices: self.CHOICES_BANKS
				}
			]
		},
		'rescan': {
			label: 'Rescan USB for devices'
		},

		'panic_one': {
			label: 'Abort actions on button',
			options: [
				{
					type: 'dropdown',
					label: 'Page',
					tooltip: 'What page is the button on?',
					id: 'page',
					default: '1',
					choices: self.CHOICES_PAGES
				},
				{
					type: 'dropdown',
					label: 'Bank',
					tooltip: 'Choosing This Button will ignore choice of Page',
					id: 'bank',
					default: '1',
					choices: self.CHOICES_BANKS
				}
			]
		},

		'panic': {
			label: 'Abort all delayed actions'
		},

		'app_exit': {
			label: 'Kill companion'
		},
		'app_restart': {
			label: 'Restart companion'
		}
	};

	self.system.emit('instance_actions', self.id, actions);

};

instance.prototype.action = function(action, extras) {
	var self = this;
	var id = action.action;
	var cmd;
	var opt = action.options;
	var thePage = 0;
	var theBank = 0;

	if (self.BUTTON_ACTIONS.includes(id)) {
		if (0 == opt.bank) {    // 'this' button
			thePage = extras.page;
			theBank = extras.bank;
		} else if (0 == opt.page) {	// 'this' page
			thePage = extras.page;
			theBank = opt.bank;
		} else {
			thePage = opt.page;
			theBank = opt.bank;
		}
	}

	// get userconfig object
	self.system.emit('get_userconfig', function(userconfig) {
		self.userconfig = userconfig;
	});

	if (id == 'instance_control') {
		self.system.emit('instance_enable', opt.instance_id, opt.enable == 'true');
	}

	else if (id == 'set_page') {
		var surface = opt.controller == 'self' ? extras.deviceid : opt.controller;
		self.changeControllerPage(surface, opt.page);
	}

	else if (id == 'set_page_byindex') {
		if (opt.controller < self.devices.length) {
			var surface = self.devices[opt.controller].serialnumber;
			self.changeControllerPage(surface, opt.page);
		} else {
			self.log('warn',"Trying to set controller #" + opt.controller +" but only " + self.devices.length + " controller(s) are available.");
		}
	}

	else if (id == 'lockout_device') {
		var surface = opt.controller == 'self' ? extras.deviceid : opt.controller;
		if(self.userconfig.pin_enable){
			// Change page after this runloop
			self.system.emit('bank_pressed', extras.page, extras.bank, false, surface);
			setImmediate(function () {
				if (self.userconfig.link_lockouts) {
					self.system.emit('lockoutall');
				} else {
					self.system.emit('lockout_device', surface, opt.page);
				}
			});
		}
	}

	else if (id == 'unlockout_device') {
		var surface = opt.controller == 'self' ? extras.deviceid : opt.controller;
		if(self.userconfig.pin_enable){
			// Change page after this runloop
			self.system.emit('bank_pressed', extras.page, extras.bank, false, surface);
			setImmediate(function () {
				if (self.userconfig.link_lockouts) {
					self.system.emit('unlockoutall');
				} else {
					self.system.emit('unlockout_device', surface, opt.page);
				}
			});
		}
	}

	else if (id == 'lockout_all') {
		if(self.userconfig.pin_enable){
			self.system.emit('bank_pressed', extras.page, extras.bank, false, surface);
			setImmediate(function () {
				self.system.emit('lockoutall');
			});
		}
	}

	else if (id == 'unlockout_all') {
		if(self.userconfig.pin_enable){
			self.system.emit('bank_pressed', extras.page, extras.bank, false, surface);
			setImmediate(function () {
				self.system.emit('unlockoutall');
			});
		}
	}

	else if (id == 'inc_page') {
		var surface = opt.controller == 'self' ? extras.deviceid : opt.controller;

		// Change page after this runloop
		setImmediate(function () {
			self.system.emit('device_page_up', surface);
		});
		/* 8-Jan-2020: fixed/obsolete. device.js now detects if a page change occurs
			between a button press and release and 'releases' the correct page-bank
		// If we change page while pushing a button, we need to tell the button that we were done with it
		// TODO: Somehow handle the futile "action_release" of the same button on the new page
		if (surface == extras.deviceid) {
			self.system.emit('bank_pressed', extras.page, extras.bank, false, surface);
		 }
		*/
	}

	else if (id == 'dec_page') {
		var surface = opt.controller == 'self' ? extras.deviceid : opt.controller;

		// Change page after this runloop
		setImmediate(function () {
			self.system.emit('device_page_down', surface);
		});

		/* 8-Jan-2020: fixed/obsolete. device.js now detects if a page change occurs
			between a button press and release and 'releases' the correct page-bank
		 // If we change page while pushing a button, we need to tell the button that we were done with it
		// TODO: Somehow handle the futile "action_release" of the same button on the new page
		if (surface == extras.deviceid) {
			self.system.emit('bank_pressed', extras.page, extras.bank, false, surface);
		}
		*/
	}

	else if (id == 'panic') {
		self.system.emit('action_delayed_abort');
	}

	else if (id == 'panic_one') {
		self.system.emit('action_abort_one', [ thePage, theBank ]);
	}

	else if (id == 'rescan') {
		self.system.emit('devices_reenumerate');
	}

	else if (id == 'bgcolor') {
		self.system.emit('bank_changefield', thePage, theBank, 'bgcolor', opt.color);
	}

	else if (id == 'textcolor') {
		self.system.emit('bank_changefield', thePage, theBank, 'color', opt.color);
	}

	else if (id == 'button_text') {
		self.system.emit('bank_changefield', thePage, theBank, 'text', opt.label);
	}

	else if (id == 'button_pressrelease') {
		var surface = opt.controller == 'self' ? extras.deviceid : opt.controller;
		self.system.emit('bank_pressed', thePage, theBank, true, surface);
		self.system.emit('bank_pressed', thePage, theBank, false, surface);
	}

	else if (id == 'button_press') {
		var surface = opt.controller == 'self' ? extras.deviceid : opt.controller;
		self.system.emit('bank_pressed', thePage, theBank, true, surface);
	}

	else if (id == 'button_release') {
		var surface = opt.controller == 'self' ? extras.deviceid : opt.controller;
		self.system.emit('bank_pressed', thePage, theBank, false, surface);
	}

	else if (id == 'exec') {
		if (opt.path !== undefined) {
			debug("Running path: '"+opt.path+"'");
			exec(opt.path, {
				timeout: opt.timeout === undefined ? 5000 : opt.timeout
			}, function(error, stdout, stderr) {
				if (error) {
					log('error', "Shell command failed. Guru meditation: " + JSON.stringify(error));
					debug(error);
				}
			});
		}
	}

	else if (id == 'app_exit') {
		self.system.emit('exit');
	}

	else if (id == 'app_restart') {
		self.system.emit('restart');
	}

};

instance.prototype.changeControllerPage = function(surface, page) {
	var self = this;

	if (page === 'back' || page === 'forward') {
		if (self.pageHistory[surface]) {
			const pageDirection = page === 'back' ? -1 : 1;
			const pageIndex = self.pageHistory[surface].index + pageDirection;
			const pageTarget = self.pageHistory[surface].history[pageIndex];

			if (pageTarget !== undefined) {
				setImmediate(function () {
					self.system.emit('device_page_set', surface, pageTarget);
				});

				self.pageHistory[surface].index = pageIndex;
			}
		}
	} else {
		// Change page after this runloop
		setImmediate(function () {
			self.system.emit('device_page_set', surface, page);
		});

		// Create page history object on first page change for a surface
		if (!self.pageHistory[surface]) {
			self.pageHistory[surface] = {
				history: [page],
				index: 0
			};
		} else {
			// Clear forward page history beyond current index, add new history entry, increment index;
			self.pageHistory[surface].history = self.pageHistory[surface].history.slice(0, self.pageHistory[surface].index + 1);
			self.pageHistory[surface].history.push(page);
			self.pageHistory[surface].index += 1;

			// Limit the max history
			const maxPageHistory = 100;
			if (self.pageHistory[surface].history.length > maxPageHistory) {
				const startIndex = self.pageHistory[surface].history.length - maxPageHistory;
				const endIndex = self.pageHistory[surface].history.length;
				self.pageHistory[surface].history = self.pageHistory[surface].history.slice(startIndex, endIndex);
			}
		}
	}

	/* 2-Jan-2020: fixed/obsolete. device.js now detects if a page change occurs
		between a button press and release and 'releases' the correct page-bank
	// If we change page while pushing a button, we need to tell the button that we were done with it
	// TODO: Somehow handle the futile "action_release" of the same button on the new page
	if (surface == extras.deviceid) {
		self.system.emit('bank_pressed', extras.page, extras.bank, false, surface);
	} */

	return;
};


function getNetworkInterfaces() {
	var interfaces = [];
	const networkInterfaces = os.networkInterfaces();

	for (const interface in networkInterfaces) {
		let numberOfAddresses = networkInterfaces[interface].length;
		for (let i = 0; i < numberOfAddresses; i++) {
			if(networkInterfaces[interface][i]['family'] === 'IPv4') {
				interfaces.push({
					label: interface,
					name: interface,
					address: networkInterfaces[interface][i]['address']
				});
			}
		}
	}

	return interfaces;
}

instance.prototype.update_variables = function (system) {
	var self = this;
	var variables = getNetworkInterfaces();
	var ip = '';

	for (let i=0; i < variables.length; i++) {
		self.setVariable(variables[i].name, variables[i].address);
		ip += variables[i].address + '\\n';
	}

	variables.push({
		label: 'Time of day (HH:MM:SS)',
		name: 'time_hms'
	});
	variables.push({
		label: 'Time of day (HH:MM)',
		name: 'time_hm'
	});
	variables.push({
		label: 'Time of day (HH)',
		name: 'time_h'
	});
	variables.push({
		label: 'Time of day (MM)',
		name: 'time_m'
	});
	variables.push({
		label: 'Time of day (SS)',
		name: 'time_s'
	});


	variables.push({
		label: 'Instances with errors',
		name: 'instance_errors'
	});
	variables.push({
		label: 'Instances with warnings',
		name: 'instance_warns'
	});
	variables.push({
		label: 'Instances OK',
		name: 'instance_oks'
	});

	variables.push({
		label: 'IP of binded network interface',
		name: 'bind_ip'
	});

	variables.push({
		label: 'IP of all network interfaces',
		name: 'all_ip'
	});

	self.setVariable('instance_errors', 0);
	self.setVariable('instance_warns', 0);
	self.setVariable('instance_oks', 0);
	self.setVariable('time_hms', '');
	self.setVariable('time_hm', '');
	self.setVariable('time_h', '');
	self.setVariable('time_m', '');
	self.setVariable('time_s', '');
	self.setVariable('bind_ip', '');
	self.setVariable('all_ip', ip);

	self.setVariableDefinitions(variables);

	// feedbacks
	var feedbacks = {};

	feedbacks['instance_status'] = {
		label: 'Companion Instance Status',
		description: 'If any companion instance encounters any errors, this will turn red',
		options: []
	};

	self.setFeedbackDefinitions(feedbacks);
};

instance.prototype.feedback = function(feedback, bank) {
	var self = this;

	if (feedback.type == 'instance_status') {

		if (self.instance_errors > 0) {
			return {
				color: self.rgb(255,255,255),
				bgcolor: self.rgb(200,0,0)
			};
		}

		if (self.instance_warns > 0) {
			return {
				color: self.rgb(0,0,0),
				bgcolor: self.rgb(255,255,0)
			};
		}

		return {
			color: self.rgb(255,255,255),
			bgcolor: self.rgb(0,200,0)
		};


	}
};








instance_skel.extendedBy(instance);
exports = module.exports = instance;
