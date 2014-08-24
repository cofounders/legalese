#!/usr/bin/env node
// let's model out the sequence of events in a convertible note financing,
// particularly conversion scenarios.

"use strict";

// a company
function Company () {
	this.name = null;
	this.country = null;
	this.identifier = null;
	this.mailing_address = null; // address for official correspondence; often corp sec.
	this.operating_address = null; // actual office.
	this.captable = { ordinary: {} };
};

// an instrument issued by the company and owned by someone
function Security () {
    this.amount = null;
    this.currency = "SGD";
	this.instrument = "generic securities";
	this.alias = "the Security";
	this.prefix = "$";
	this.getInfo = function() {
		return ("This is an instance of " + this.instrument + ", of amount " +
				this.prefix + this.amount + " " + this.currency + "\n");
	};
	this.subscriber = null;
	this.company = null;
}

// a security that is able to convert to another security
function Convertible_Security () {
	Security.call(this);
	this.instrument="convertible securities";
	this.converts_to={name:"Conversion Shares"};
	this.term = null;
}
Convertible_Security.prototype = new Security ();
Convertible_Security.prototype.constructor = Convertible_Security;
Convertible_Security.prototype.getInfo = function() {
	process.stdout.write("hello, this is inside the inheritor's overriding method\n");
	var toreturn = this.getInfo();
	toreturn += "Furthermore, I convert to " + this.converts_to.name + "\n";
	return toreturn;
};

function SAFE () { };

function SAFE_cap_nodiscount () { };

function SAFE_nocap_discount () { };

function SAFE_MFN () {};

// export all the above

exports.Company = Company;
exports.Security = Security;
exports.Convertible_Security = Convertible_Security;

