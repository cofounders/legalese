#!/usr/bin/env node

var investment = require("./convertible-note-code.js");

// here we test a bunch of this stuff

var mygeneric = new investment.Security();
mygeneric.amount = 100;
process.stdout.write(mygeneric.getInfo());

var mynotes = new investment.Convertible_Security();
mynotes.amount = 100000;
process.stdout.write(mynotes.getInfo());

