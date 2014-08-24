#!/usr/bin/env node
// let's model out the sequence of events in a convertible note financing,
// particularly conversion scenarios.

(function(){
"use strict";

// a company
function Company () {
	this.name = null;
	this.country = null;
	this.identifier = null;
	this.mailing_address = null; // address for official correspondence; often corp sec.
	this.operating_address = null; // actual office.
	this.captable = { ordinary: {} };
}

// an instrument issued by the company and owned by someone
function Security ( args ) {
	var from_args = ["price",
					 "instrument",
					 "currency",
					 "alias",
					 "prefix",
					 "subscriber",
					 "company",
					];
	var defaults = { prefix: "$",
					 currency: "SGD",
					 instrument: "generic corporate securities" };
	for (var i = 0; i < from_args.length; i++) {
		if (this[from_args[i]] == undefined) {
			this[from_args[i]] = args[from_args[i]] ? args[from_args[i]] : defaults[from_args[i]];
		}
	}
}

Security.prototype.getInfo = function () {
		return ("This is an instance of " + this.instrument + ", of price " +
				this.prefix + this.price + " " + this.currency + "\n");
};

// a security that is able to convert to another security
function Convertible_Security ( args ) {
	var defaults = { instrument: "convertible securities" };
	var from_args = ["instrument",
					 "conversion_upon",
					 "qualified_financing",
					 "converts_to",
					 "conversion_price",
					 "automatic_conversion"];
	for (var i = 0; i < from_args.length; i++) {
		this[from_args[i]] = args[from_args[i]] ? args[from_args[i]] : defaults[from_args[i]];
	}
	Security.call(this, args);
}
Convertible_Security.prototype = Object.create(Security.prototype);
Convertible_Security.prototype.constructor = Convertible_Security;
Convertible_Security.prototype.getInfo = function() {
	var toreturn = Security.prototype.getInfo.call(this);
	toreturn += "  Furthermore, I convert to " + this.converts_to.name + "\n";
	return toreturn;
};

// debt security
function Note ( args ) {
	var defaults = { instrument: "promissory notes" };
	var from_args = ["term",
					 "interest",
					 "instrument",
					];
	for (var i = 0; i < from_args.length; i++) {
		this[from_args[i]] = args[from_args[i]] ? args[from_args[i]] : defaults[from_args[i]];
	}
	Security.call(this, args);
}
Note.prototype = Object.create(Security.prototype);
Note.prototype.constructor = Note;
Note.prototype.getInfo = function() {
	var toreturn = Security.prototype.getInfo.call(this);
	toreturn += "  I accrue interest at " + this.interest + " per annum and mature after " + this.term + "\n";
	return toreturn;
};


function SAFE_cap_nodiscount () { }

function SAFE_cap_discount () { }

function SAFE_nocap_discount () { }

function SAFE_nocap_nodiscount_MFN () { }

// export all the above

exports.Company = Company;
exports.Security = Security;
exports.Convertible_Security = Convertible_Security;
exports.Note = Note;

}());
