#!/usr/bin/env node

"use strict";

var investment = require("./convertible-note-code.js");

// here we test a bunch of this stuff

var mygeneric = new investment.Security( { price:100 } );
process.stdout.write(mygeneric.getInfo());

var myconv = new investment.Convertible_Security( { price:100000, converts_to:{name: "Conversion Shares" } } );
process.stdout.write(myconv.getInfo());

var mydebt = new investment.Note( { price:250000, interest:6, term:"3y", converts_to:{name: "Conversion Shares" } } );
process.stdout.write(mydebt.getInfo());

