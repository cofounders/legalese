#!/usr/bin/env node

"use strict";

var investment = require("./convertible-note-code.js");

// here we test a bunch of this stuff

var mygeneric = new investment.Security( { amount:100 } );
process.stdout.write(mygeneric.getInfo());

var mynotes = new investment.Convertible_Security( { amount:100000 } );
process.stdout.write(mynotes.getInfo("moo"));

