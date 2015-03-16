#!/usr/bin/env node

"use strict";

var investment = require("./convertible-note-code.js");

// here we test a bunch of this stuff

var mygeneric = new investment.Generic( { price:100 } );
process.stdout.write(mygeneric.getInfo() + "\n");

var myconvnote = new investment.ConvertibleNote( {
	price:       100000,
	interest:    6,
	term:        "3y",
	converts_to: {name: "Conversion Shares" } } );
process.stdout.write(myconvnote.getInfo() + "\n");

var mydebt = new investment.Note( {
	price:       100000,
	interest:    4,
	term:        "2y",
	});
process.stdout.write(mydebt.getInfo() + "\n");
