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

// convertible instruments, debt, and other securities are implemented as mixins on top of a basic Security object.
//
// http://javascriptweblog.wordpress.com/2011/05/31/a-fresh-look-at-javascript-mixins/
//
// a Security is an instrument issued by the company and owned by someone

var Security = function() { // the function-function is needed so that the prototypes don't merge
	return function(args) {
//		process.stderr.write("Security: executing init_LIST("+this.init_LIST.length+")\n");
		for (var i = 0; i < this.init_LIST.length; i++) { this.init_LIST[i].call(this,args); }
//		process.stderr.write("Security: executing arglist("+this.arglist.length+")\n");
		for (var i = 0; i < this.arglist.length; i++) {
			this[this.arglist[i]] = args[this.arglist[i]] ? args[this.arglist[i]] : this.defaults[this.arglist[i]];
//			process.stderr.write("Security.init: this."+this.arglist[i]+"="+this[this.arglist[i]]+"\n");
		}
	};
};

var isSecurity = function () {
	this.arglist = [];
	this.defaults = {};
	this.getInfo_LIST = [function() { return "This is an instance of " + this.instrument + ", of price " + this.prefix + this.price + " " + this.currency + "\n"; }];
	this.init_LIST = [function() {
		this.arglist.push("price", "instrument", "currency", "alias", "prefix", "subscriber", "company");
		this.defaults.prefix = "$";
		this.defaults.currency = "SGD";
		this.defaults.instrument = "generic corporate securities";
	}];

	this.getInfo = function() {
		var toreturn = "";
		for (var i = 0; i < this.getInfo_LIST.length; i++) {
			toreturn += this.getInfo_LIST[i].call(this);
		}
		return toreturn;
	};
	return this;
};

var Generic = Security();
isSecurity.call(Generic.prototype);

// MIXIN isConvertible: a security that is able to convert to another security
var isConvertible = function() {
	this.init_LIST.push(function() {
		this.arglist.push("conversion_upon", "qualified_financing", "converts_to", "conversion_price", "automatic_conversion");
		this.defaults.instrument = "convertible securities";
		this.defaults.converts_to = { name: "Conversion Shares" };
		this.defaults.conversion_upon = "qualified financing";
	});
	this.getInfo_LIST.push ( function() { return "  Furthermore, being a convertible security, upon " + this.conversion_upon + " I will convert to " + this.converts_to.name + "\n"; });
	return this;
};

var Convertible = Security();
isSecurity.call(Convertible.prototype);
isConvertible.call(Convertible.prototype);

// MIXIN isNote: a security that bears interest and is repayable at the maturity date
var isNote = function() {
	this.init_LIST.push(function() {
		this.arglist.push("term", "interest");
		this.defaults.instrument = "debt notes";
	});
	this.getInfo_LIST.push( function() { return "  Furthermore, being a debt instrument, I accrue " + this.interest + "% interest, repayable after "+this.term+"\n"; });
};

var Note = Security();
isSecurity.call(Note.prototype);
isNote.call(Note.prototype);


// triple mixin: the whole point of this exercise.
var ConvertibleNote = Security();
isSecurity.call(ConvertibleNote.prototype);
isConvertible.call(ConvertibleNote.prototype);
isNote.call(ConvertibleNote.prototype);


// export

exports.Company = Company;
exports.Generic = Generic;
exports.Note    = Note;
exports.Convertible = Convertible;
exports.ConvertibleNote = ConvertibleNote;

}());





/*
 shall mean the next sale (or series of related sales) by the Company
 of its Preferred Stock following the Date of Issuance from which the
 Company receives gross proceeds of not less than $1,000,000 (excluding
 	the aggregate amount of securities converted into Common or Preferred Stock
 	in connection with such sale (or series of related sales)).

*/

function onFinancing(event) {
	// does this qualify as a NextEquityFinancing?

	if (isNextEquityFinancing()) { this.convert(true) }
}


function isNextEquityFinancing(event) {
	return (event.date > this.dateOfIssuance
		&&
		event.GrossProceeds(excluding_this(TRUE)) > 1000000
		&&
		event.PreMoneyValution > 50000000
		);
}


/*
with respect to a conversion pursuant to Clause 3.1 (Next Equity Financing),
shares of the Company’s Preferred Stock issued in the Next Equity Financing;
provided, however, that, at the Company’s election,
"Conversion Shares” with respect to a conversion pursuant to Clause 3.1
shall mean shares of a Shadow Series;
*/

function convert() {
	delete_old_shares(this.shares);
	company.create_new_shares(this.shareholder, newShares()
}

function newShares() {}
	var security = Security;
	if (isNextEquityFinancing(event)) { // 3.1
		security.type = event.securitytype;
		if (company.directors.elect("regarding security types")) {
			security.type = event.mkShadowSeries();
		}
		return security;
	}
	if (isCorporateTransaction(event)) { // 3.2
		security.type = company.common;
		security.amount = ...;
		return security;
	}

	die "some conversion event was not handled correctly";
	return undefined; // die on error so the unit tests will pick this up.

}

unit_test(conversion, PreMoneyValution = 1000000);
unit_test(conversion, PreMoneyValution = 10000000);
unit_test(conversion, PreMoneyValution = 100000000);
