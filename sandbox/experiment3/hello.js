
console.log("The correct language for this project is LISP, but more people know Javascript. Sigh. Kids nowadays.");

var all_my_legalparties = [];
var all_my_legalvars = [];
var all_my_legalevents = [];
var all_my_legalinstruments = [];

function para(style, contents) { console.log("<"+style+">"+contents+"</"+style+">"); }
function LegalParty(options) {
	this.options = options;  // fullname, address, IDval, IDtype
	this.money = 1;
	this.isBankrupt = function() { return this.money <= 0 };
	all_my_legalparties.push(this);
}
function LegalVar(val, natural, mytype) { this.val = val; this.natural = natural; this.mytpe = mytype; all_my_legalvars.push(this) }
function LegalInstrument(options) {
	this.options = options;
	this.shortname = function() { return options.a + " " + options.shortname };
	this.definitions = options.definitions;
	this.parties = options.parties;
	this.lender = options.lender;
	this.borrower = options.borrower;

	para("H1", "Parties");
	for (i in options.parties) {
		var party = options.parties[i];
		para("parties", party.options['fullname'] + " (" + party.options['IDtype'] + " " + party.options['IDval']
			 + "), a " + party.options['entitytype'] + " living at " + party.options['address']);
	}

	para("H1", "Definitions");
	for (i in options.definitions) {
		var def = options.definitions[i];
		para("definition", def.natural['en'] + "\tmeans " + def.val);
	}

	// manage signatures
	this.signatures = {};

	// signatures getter
	this.date_signed_by = function(party) {
		if (this.signatures.hasOwnProperty(party.options.fullname) && this.signatures[party.options.fullname].hasOwnProperty("signed_on")) {
			return this.signatures[party.options.fullname].signed_on;
		}
		return undefined;
	};

	// signatures setter
	this.record_signature = function(party, date) { this.signatures[party.options.fullname] = { signed_on: date }; }

	// signatures tester
	this.agreement_condition = function() {
		return this.parties.every(function(party){ return(this.date_signed_by(party) <= this.definitions.completion.val) }, this)
	};

	// manage funds
	this.funds_transferred_by = {};

	// funds setter ... tell me there's a more elegant way to say this!
	this.record_funds_transfer = function(party, details) { if (! this.funds_transferred_by.hasOwnProperty(party.options.fullname)) { this.funds_transferred_by[party.options.fullname] = 0 }
															this.funds_transferred_by[party.options.fullname] += details.amount };
	
	// funds tester
	this.completion_condition = function() {
		return this.funds_transferred_by.hasOwnProperty(this.lender.options.fullname) && this.funds_transferred_by[this.lender.options.fullname] >= this.definitions.principal.val;
	}

	all_my_legalinstruments.push(this);
}

function LegalEvent(name, pre_conditions, neg_conditions, act) { this.name=name; this.pre_conditions=pre_conditions; this.neg_conditions=neg_conditions;
																 this.act = act; all_my_legalevents.push(this) }

// variable definitions
var bob = new LegalParty({fullname:"Bob The Dog", address: "1 Nassim Drive, Singapore", IDval:"S1111111A", IDtype:"NRIC", entitytype:"person", shortname:"the Borrower"});
var cal = new LegalParty({fullname:"Cal the Cat", address: "2 Oxley Rise, Singapore",   IDval:"S2222222B", IDtype:"NRIC", entitytype:"person", shortname:"the Lender"});

var agreement  =  new LegalVar("20141114", { en:"Date of Agreement", de:"Datum der Einigung" }, "date");
var completion =  new LegalVar("20141201", { en:"Completion Date" },   "date");
var expiration =  new LegalVar("20150101", { en:"Expiration Date" },   "date");
var interest   =  new LegalVar(6,          { en:"Interest",            show:function(val){return val+"%"} },          "percentage");
var principal  =  new LegalVar(25000,      { en:"Principal Amount" },  "currencyamount");
var currency   =  new LegalVar("SGD",      { en:"Singapore Dollars"},  "currencytype");

var liquidation_event = new LegalEvent("liquidation", function(){
	return (this.company.isBankrupt());
});
var early_redemption_event = new LegalEvent("early redemption", function(current_date){
	return (this.definitions.expiration.val >= current_date);
},
											null,
											function(){
												console.log("early redemption is happening.");
											}
										   );

var note = new LegalInstrument({shortname:"Note", a:"a", plural:"Notes",
								parties: all_my_legalparties,
								preamble: { en:function(){ bob + " wishes to lend " + principal + " to " + cal + " in the form of " + this.shortname() } },
								definitions: { agreement:agreement, completion:completion, expiration:expiration, interest:interest, principal:principal, currency:currency },
								events: all_my_legalevents,
								lender: cal,
								borrower: bob,
							   });

note.record_funds_transfer(cal, { amount: 12500, date: "20141130" });
// note.record_funds_transfer(cal, { amount: 12500, date: "20141130" });

if (note.completion_condition()) { console.log("completion condition is satisfied") }

note.record_signature(bob, "20131115");
// note.record_signature(cal, "20131117");

if (note.agreement_condition()) { console.log("agreement condition is satisfied") }


