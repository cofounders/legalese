// ---------------------------------------------------------------------------------------------------------------- onOpen
/**
 * Adds a custom menu to the active spreadsheet.
 * The onOpen() function, when defined, is automatically invoked whenever the
 * spreadsheet is opened.
 * For more information on using the Spreadsheet API, see
 * https://developers.google.com/apps-script/service_spreadsheet
 */
function onOpen() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var entries = [
  { name:"Create Form", functionName:"setupForm_"},
  { name:"Generate Docs", functionName:"fillTemplates"},
  { name:"Send to EchoSign", functionName:"uploadAgreement"},
  { name:"quicktest", functionName:"quicktest"},
  ];
  spreadsheet.addMenu("Legalese", entries);
  // when we release this as an add-on the menu-adding will change.

  resetUserProperties("oauth2.echosign");

// resetUserProperties("legalese.folder.id");
// resetUserProperties("legalese.rootfolder");

//  getEchoSignService().reset();
  // blow away the previous oauth, because there's a problem with using the refresh token after the access token expires after the first hour.

  showSidebar();
};


// ---------------------------------------------------------------------------------------------------------------- setupForm
/**
 * establish a form for parties to fill in their personal details
 *
 */
function setupForm_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var cell = ss.getSheetByName("Deal Terms").getRange("E4");

  var form = ss.getFormUrl();
  var data = readRows_();

  if (form != undefined) {
    var ui = SpreadsheetApp.getUi();
    var response = ui.prompt('A form was previously created.', 'Reset it?', ui.ButtonSet.YES_NO);

	if (response.getSelectedButton() == ui.Button.NO) { return }
	cell.setValue("resetting form"); SpreadsheetApp.flush();
    form = FormApp.openByUrl(form);
	var items = form.getItems();
	for (var i in items) {
	  form.deleteItem(0);
	}
  }	  
  else {
	cell.setValue("creating form"); SpreadsheetApp.flush();
	form = FormApp.create('Personal Particulars - ' + ss.getName())
      .setDescription('Please fill in your details regarding ' + data.parties.company[0].name + ".")
      .setConfirmationMessage('Thanks for responding!')
      .setAllowResponseEdits(true)
      .setAcceptingResponses(true)
	  .setProgressBar(true);

	// don't create a new trigger if there is already one available
	var triggers = ScriptApp.getUserTriggers(ss);
	if (triggers.length > 0 && // is there already a trigger for onFormSubmit?
		triggers.filter(function(t) { return t.getEventType() == ScriptApp.EventType.ON_FORM_SUBMIT }).length > 0) {
	  Logger.log("we already have an onFormSubmit trigger, so no need to add a new one.");
	}
	else {
	  ScriptApp.newTrigger('onFormSubmit').forSpreadsheet(ss).onFormSubmit().create();
	}
  }

  // Create the form and add a multiple-choice question for each timeslot.
  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
  var origpartyfields = data._origpartyfields;
  Logger.log("origpartyfields = " + origpartyfields);
  for (var i in origpartyfields) {
	var partyfield = origpartyfields[i];
	Logger.log("partyfield "+i+" = " + partyfield);
	if (partyfield.itemtype.match(/^list/)) {
	  var enums = partyfield.itemtype.split(' ');
	  enums.shift();
	  form.addListItem()
		.setTitle(partyfield.fieldname)
		.setRequired(partyfield.required)
		.setChoiceValues(enums)
		.setHelpText(partyfield.helptext);
	}
	else if (partyfield.itemtype.match(/^(email|number)/)) {
	  form.addTextItem()
		.setTitle(partyfield.fieldname)
		.setRequired(partyfield.required)
		.setHelpText(partyfield.helptext);
	  // in the future, when Google Apps Scripts adds validation to its FormApp, validate the input as a valid email address or number as appropriate.
	}
	else if (partyfield.itemtype.match(/^text/)) {
	  form.addTextItem()
		.setTitle(partyfield.fieldname)
		.setRequired(partyfield.required)
		.setHelpText(partyfield.helptext);
	}	  
	else if (partyfield.itemtype.match(/^hidden/)) {
	  // we don't want to display the Legalese Status field.
	}	  
  }

  var config = readConfig();

  for (var i in config.form_extras.values) {
	var field = asvar_(config.form_extras.values[i]);
	form.addListItem()
	  .setTitle(config[field].dict["name"][0])
	  .setRequired(config[field].dict["required"][0])
	  .setChoiceValues(config[field].dict["choicevalues"])
	  .setHelpText(config[field].dict["helptext"][0]);
  }

  var form_url = form.getPublishedUrl();
  var short_url = form.shortenFormUrl(form_url);

  cell.setValue(short_url); SpreadsheetApp.flush();

  var legalese_root = legaleseRootFolder_();
  legalese_root.addFile(DriveApp.getFileById(form.getId()));
  legalese_root.addFile(DriveApp.getFileById(ss.getId()));
  Logger.log("added to legalese root folder");
}

// ---------------------------------------------------------------------------------------------------------------- readConfig_
// each config row produces multiple representations:
// config.columna.values is an array of values -- if columna repeats, then values from last line only
// config.columna.dict is a dictionary of b: [c,d,e] across multiple lines

function readConfig() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("README");

  var rows = sheet.getDataRange();
  var numRows = rows.getNumRows();
  var values = rows.getValues();
  var section = "prologue";

  var config = {};
  var previous = [];

  for (var i = 0; i <= numRows - 1; i++) {
    var row = values[i];

	// process header rows
	if (row[0] == "CONFIGURATION") { section = row[0]; continue }
	if (section == "CONFIGURATION") {
	  Logger.log("row " + i + ": processing row "+row[0]);
	  
	  // populate the previous
	  var columna = asvar_(row[0]) || previous[0];
	  previous[0] = columna;

	  Logger.log("columna="+columna);
	  config[columna] = config[columna] || { asRange:null, values:null, dict:{}, tree:{} };
	  Logger.log("config[columna]="+config[columna]);

	  config[columna].asRange = sheet.getRange(i+1,1,1,sheet.getMaxColumns());
	  Logger.log(columna+".asRange=" + config[columna].asRange.getValues()[0].join(","));

	  var rowvalues = config[columna].asRange.getValues()[0];
	  while (rowvalues[rowvalues.length-1] === "") { rowvalues.pop() }
	  Logger.log("rowvalues = %s", rowvalues);

	  var descended = [columna];

	  var leftmost_nonblank = -1;
	  for (var j = 0; j < rowvalues.length; j++) {
		if (leftmost_nonblank == -1
			&& (! (rowvalues[j] === ""))) { leftmost_nonblank = j }
	  }
	  Logger.log("leftmost_nonblank=%s", leftmost_nonblank);
	  for (var j = 0; j < leftmost_nonblank; j++) {
		descended[j] = previous[j];
	  }
	  for (var j = leftmost_nonblank; j < rowvalues.length; j++) {
		if (j >= 1 && ! (rowvalues[j] === "")) { previous[j] = rowvalues[j] }
		descended[j] = rowvalues[j];
	  }
	  Logger.log("descended = %s", descended);

	  // build values -- config.a.values = [b,c,d]
	  config[columna].values = descended.slice(1);
	  Logger.log(columna+".values=%s", config[columna].values.join(","));

	  // build tree -- config.a.tree.b.c.d.e.f=g
	  treeify_(config[columna].tree, descended.slice(1));

	  // build dict -- config.a.dict.b = [c,d,e]
	  var columns_cde = config[columna].values.slice(1);
	  if (columns_cde[0] == undefined) { continue }
	  var columnb = asvar_(descended[1]);

	  config[columna].dict[columnb] = columns_cde;
	  Logger.log("%s", columna+".dict."+columnb+"=" + config[columna].dict[columnb].join(","));
	}
  }
  Logger.log("returning\n" + JSON.stringify(config,null,"  "));
  return config;
}
function treeify_(root, arr) {
  if      (arr.length == 2) { root[arr[0]] = arr[1] }
  else if (arr.length == 1) { root[arr[0]] = null   }
  else if (arr.length == 0) { return }
  else                      { if (root[arr[0]] == undefined) root[arr[0]] = {}; treeify_(root[arr[0]], arr.slice(1)) }
}


// {
//   "form_extras": {
//     "asRange": {},
//     "values": [
//       "Party Types",
//       "Second Element"
//     ],
//     "dict": {
//       "party_types": [
//         "Second Element"
//       ]
//     }
//   },
//   "party_types": {
//     "asRange": {},
//     "values": [
//       "helptext",
//       "Your role, please."
//     ],
//     "dict": {
//       "name": [
//         "Party Role"
//       ],
//       "choicevalues": [
//         "Founder",
//         "Company",
//         "Investor",
//         "Existing Shareholder"
//       ],
//       "required": [],
//       "helptext": [
//         "Your role, please."
//       ]
//     }
//   },
//   "second_element": {
//     "asRange": {},
//     "values": [
//       "",
//       "",
//       " "
//     ],
//     "dict": {
//       "boo": [],
//       "": [
//         "",
//         " "
//       ]
//     }
//   }
// }


// ---------------------------------------------------------------------------------------------------------------- onFormSubmit
/**
 * A trigger-driven function that sends out calendar invitations and a
 * personalized Google Docs itinerary after a user responds to the form.
 *
 * @param {Object} e The event parameter for form submission to a spreadsheet;
 *     see https://developers.google.com/apps-script/understanding_events
 */
function onFormSubmit(e) {
  Logger.log("onFormSubmit: beginning");
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Deal Terms");
  var data = readRows_();
  // add a row and insert the investor fields
  Logger.log("inserting a row after " + (parseInt(data._last_party_row)+1));
  sheet.insertRowAfter(data._last_party_row+1); // might need to update the commitment sum range
  var newrow = sheet.getRange(data._last_party_row+2,1,1,sheet.getMaxColumns());
//  newrow.getCell(0,0).setValue("bar");

  // loop through the origpartyfields inserting the new data in the right place.
  for (names in e.namedValues) {
	Logger.log("e.namedValues = " + names + ":"+e.namedValues[names][0]);
  }

  var origpartyfields = data._origpartyfields;
  Logger.log("onFormSubmit: origpartyfields = " + origpartyfields);
  newrow.getCell(1,1).setValue(e.namedValues["Party Role"][0]);

  for (var i in origpartyfields) {
	var partyfield = origpartyfields[i];
	Logger.log("partyfield "+i+" (" + partyfield.fieldname+") (column="+partyfield.column+") = " + e.namedValues[partyfield.fieldname][0]);

	var newcell = newrow.getCell(1,parseInt(partyfield.column));
	Logger.log("setting value of cell to " + e.namedValues[partyfield.fieldname]);
	newcell.setValue(e.namedValues[partyfield.fieldname][0]);
  }
}

// ---------------------------------------------------------------------------------------------------------------- readRows
/**
 * populate the data.* structure
 * the PARTIES go into data.parties.founder.*, data.parties.existing_shareholder.*, data.parties.company.*, data.parties.investor.* as arrays
 * the TERMS go into data.* directly.
 * if a availabletemplate is marked as binary then we iterate through the investors and set data.investor.* each time
 */
function readRows_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Deal Terms");
  var rows = sheet.getDataRange();
  var numRows = rows.getNumRows();
  var values = rows.getValues();
  var terms = { _parties_last_filled_column: 0,
				_first_party_row: 0,
			  };
  var section = "prologue";
  var partyfields = [];
  var origpartyfields = [];
  var partyfieldorder = []; // table that remaps column number to order-in-the-form
  var parties = { _allparties:[], _unmailed:[], founder:[], existing_shareholder:[], company:[], investor:[] }; // others ok in the form
  // maybe we should do it this way and just synthesize the partygroups as needed, along with any other filters.
  var terms_row_offset;

  Logger.log("readRows: starting.");

// get the formats for the B column -- else we won't know what currency the money fields are in.
  var term_formats = sheet.getRange(1,2,numRows).getNumberFormats();

  var es_num = 1; // for email orderng the EchoSign fields

  for (var i = 0; i <= numRows - 1; i++) {
    var row = values[i];
	Logger.log("readRows: row " + i + ": processing row "+row[0]);
	// process header rows
    if      (row[0] == "KEY TERMS") { section=row[0]; terms_row_offset = i; continue; }
    else if (row[0] == "IGNORE") { 
	  section = row[0];
	  continue;
	}
    else if (row[0] == "PARTYFORM_ORDER") { section=row[0]; for (var ki in row) { if (ki<1||row[ki]==undefined||!row[ki]){continue}
																				  partyfieldorder[ki] = row[ki];
																				  origpartyfields[partyfieldorder[ki]] = origpartyfields[partyfieldorder[ki]]||{};
																				  origpartyfields[partyfieldorder[ki]].column = parseInt(ki)+1;
																				  origpartyfields[partyfieldorder[ki]].row    = i+1;
																				  Logger.log("readRows: learned that field with order "+row[ki]+ " is in row %s column %s ", origpartyfields[partyfieldorder[ki]].row, origpartyfields[partyfieldorder[ki]].column);
																				}
											continue;
										  }
    else if (row[0] == "PARTYFORM_HELPTEXT") { section=row[0]; for (var ki in row) { if (ki<1||row[ki]==undefined||partyfieldorder[ki]==undefined){continue}
																					 origpartyfields[partyfieldorder[ki]].helptext = row[ki];
																				   }
											continue;
										  }
    else if (row[0] == "PARTYFORM_ITEMTYPE") { section=row[0]; for (var ki in row) { if (ki<1||row[ki]==undefined||partyfieldorder[ki]==undefined){continue}
																					 origpartyfields[partyfieldorder[ki]].itemtype = row[ki];
																				   }
											continue;
										  }
    else if (row[0] == "PARTYFORM_REQUIRED") { section=row[0]; for (var ki in row) { if (ki<1||row[ki]==undefined||partyfieldorder[ki]==undefined){continue}
																					 Logger.log("readRows: line "+i+" col "+ki+": learned that field with order "+partyfieldorder[ki]+ " has required="+row[ki]);
																					 origpartyfields[partyfieldorder[ki]].required = row[ki];
																				   }
											continue;
										  }
    else if (row[0] == "PARTIES")   {
	  section = row[0]; partyfields = row;
	  while (row[row.length-1] === "") { row.pop() }
	  terms._parties_last_filled_column = row.length-1;
	  Logger.log("readRows: _parties_last_filled_column = %s", terms._parties_last_filled_column);

      for (var ki in partyfields) {
		if (ki < 1 || row[ki] == undefined) { continue }
        origpartyfields[partyfieldorder[ki]] = origpartyfields[partyfieldorder[ki]] || {};
        origpartyfields[partyfieldorder[ki]].fieldname = row[ki];
		// Logger.log("readRows: learned origpartyfields["+partyfieldorder[ki]+"].fieldname="+row[ki]);
        partyfields[ki] = partyfields[ki].toLowerCase().replace(/\s+/g, ''); // TODO; convert this to asvar_()
		Logger.log("readRows: recorded partyfield[%s]=%s", ki, partyfields[ki]);
      }
      continue;
	}

	// process data rows
    if (section == "KEY TERMS") {
      if ( row[0].length == 0) { continue }
      terms[asvar_(row[0])] = formatify_(term_formats[i][0], row[1]);
    }
    else if (section == "PARTIES") { // Name	partygroup	Email	IDtype	ID	Address	State	InvestorType Commitment etc
      var singleparty = { _spreadsheet_row:i+1, _unmailed:false };
      var party_formats = sheet.getRange(i+1,1,1,row.length).getNumberFormats();
	  if (terms._first_party_row == 0) terms._first_party_row = i;
	  terms._last_party_row = i;

      for (var ki in partyfields) {
        if (ki < 1) { continue }
        var k = partyfields[ki];
        var v = formatify_(party_formats[0][ki],row[ki]);

        singleparty[k] = v;
      }
      var partytype = asvar_(row[0]);
	  if (partytype == undefined || ! partytype.length) { continue }

      Logger.log("readRows: learning entire %s, %s", partytype, singleparty);
	  if (parties[partytype] == undefined) { parties[partytype] = [] }

	  if (singleparty.legalesestatus.toLowerCase() == "ignore") { continue }

      parties[partytype].push(singleparty);
	  parties._allparties.push(singleparty);

	  // set up the _unmailed attribute
	  if (singleparty.legalesestatus == undefined || singleparty.legalesestatus === "") {
		Logger.log("readRows: party %s hasn't been mailed yet. it will have es_num %s", singleparty.name, es_num);
		singleparty._unmailed = true;
		singleparty._es_num = es_num++;
		parties._unmailed.push(singleparty);
	  }
	  else if (singleparty.legalesestatus.toLowerCase().match(/^(done|ignore|skip|mailed|cc)/i)) {
		Logger.log("readRows: founder %s has status %s, so leaving out from parties._unmailed", singleparty.name, singleparty.legalesestatus);
	  }
	  else {
		Logger.log("readRows: founder %s has status %s; not sure what that means, but leaving out from parties._unmailed", singleparty.name, singleparty.legalesestatus);
	  }

    }
  }
  terms._origpartyfields = origpartyfields;
  terms._partyfields = partyfields;
  terms.parties = parties;
  return terms;
};

function getPartyCells_(sheet, readrows, party) {
  Logger.log("looking to return a dict of partyfieldname to cell, for party %s", party.name);
  Logger.log("party %s comes from spreadsheet row %s", party.name, party._spreadsheet_row);
  Logger.log("the fieldname map looks like this: %s", readrows._partyfields);
  Logger.log("so the cell that matters for legalesestatus should be row %s, col %s", party._spreadsheet_row, readrows._partyfields.indexOf("legalesestatus")+1);
  Logger.log("calling (getRange %s,%s,%s,%s)", party._spreadsheet_row, 1, 1, readrows._partyfields.length+1);
  var range = sheet.getRange(party._spreadsheet_row, 1, 1, readrows._partyfields.length+1);
  Logger.log("pulled range %s", JSON.stringify(range.getValues()));
  var toreturn = {};
  for (var f = 0; f < readrows._partyfields.length ; f++) {
	Logger.log("toreturn[%s] = range.getCell(%s,%s)", readrows._partyfields[f], 0+1,f+1);
	toreturn[readrows._partyfields[f]] = range.getCell(0+1,f+1);
  }
  return toreturn;
}

function asvar_(str) {
  if (str == undefined) { return undefined }
  return str.toString().replace(/[ -.]/g, "_").replace(/:/g, "").toLowerCase();
}

// ---------------------------------------------------------------------------------------------------------------- formatify_
// Wed Dec 17 05:17:57 PST 2014 INFO: term 150000 has format [$S$]#,##0
// Wed Dec 17 05:17:57 PST 2014 INFO: term 2500000 has format [$$]#,##0.00
// Wed Dec 17 05:17:57 PST 2014 INFO: term All has format 0.###############
// Wed Dec 17 05:17:57 PST 2014 INFO: term 0.02 has format 0.00%
// Wed Dec 17 05:17:57 PST 2014 INFO: term 36 months has format 0.###############
// Wed Dec 17 05:17:57 PST 2014 INFO: term 2000000 has format [$SGD $]#,##0.00
// Wed Dec 17 05:17:57 PST 2014 INFO: term 0.2 has format 0%

// google's raw format expresses 1% as 0.01.
function formatify_(format, string) {
  var toreturn;
  if (format != undefined) {
    var matches;
    if (matches = format.match(/\[\$(.*)\]/)) { // currency
      var currency = matches[0].substring(2,matches[0].length-1).replace(/ /g," "); // nbsp

      // it would be nice to fill in the format string exactly the way Spreadsheets do it, but that doesn't seem to be an option.
      // failing that, it would be nice to get support for the ' option in sprintf, but it looks like formatString doesn't do that one either.
      // failing that, SheetConverter has a convertCell function that should do the job. https://sites.google.com/site/scriptsexamples/custom-methods/sheetconverter
      // but that doesn't work either. so we do it by hand.
      var parts = string.toString().split(".");
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      toreturn = currency + parts.join(".");
    }
    else if (format.match(/%$/)) {
      toreturn = string * 100;
    }
    else if (format.match(/yyyy/)) {
    // Thu Dec 18 09:03:28 PST 2014 INFO: expanding term Fri Dec 19 2014 00:00:00 GMT+0800 (HKT) with format yyyy"-"mm"-"dd
    // Thu Dec 18 09:03:28 PST 2014 INFO: expanding term Thu Jan 15 2015 00:00:00 GMT+0800 (HKT) with format yyyy"-"mm"-"dd
      toreturn = string.toString().substr(0,15);
    } else { toreturn = string }
  }
  else { toreturn = string }
//  Logger.log("formatify_("+format+","+string+") = "+toreturn);
  return toreturn;
}

// ---------------------------------------------------------------------------------------------------------------- clauseroot / clausetext2num
var clauseroot = [];
var clausetext2num = {};
var hintclause2num = {};

// ---------------------------------------------------------------------------------------------------------------- clausehint
// xml2html musters a hint database of clause text to pathindex.
// at the start of the .ghtml file all the hints are passed to the HTMLTemplate engine by calling
// a whole bunch of clausehint()s at the front of the file
function clausehint(clausetext, pathindex, uniqtext) {
  hintclause2num[uniqtext || clausetext] = pathindex.join(".");
}

// ---------------------------------------------------------------------------------------------------------------- newclause
function newclause(level, clausetext, uniqtext, tag) {
  var clause = clauseroot; // navigate to the desired clause depending on the level
  var pathindex = [clause.length];
  for (var i = 1; i < level; i++) {
    clause = clause[clause.length-1][0];
    pathindex.push(clause.length);
  }
  clause.push([[],clausetext]);

  pathindex[pathindex.length-1]++;
  clausetext2num[uniqtext || clausetext] = pathindex.join(".");
  if (clausetext == undefined) { // bullet
	var myid = pathindex.join("_");
//	return "<style>#"+myid+":before { display:block; content: \"" + pathindex.join(".") + ". \" } </style>" + "<li id=\"" + myid + "\">";
	return "<p class=\"ol_li level" + level+ "\">" + pathindex.join(".") + " ";
  } else {
      return "<h"+(level+0)+">"+pathindex.join(".") + ". " + clausetext + "</h"+(level+0)+">";
  }
}

// ---------------------------------------------------------------------------------------------------------------- clausenum
// this is going to have to make use of a hinting facility.
// the HTML template is filled in a single pass, so forward references from showclause() to newclause() will dangle.
// fortunately the newclauses are populated by xml2html so we can muster a hint database.
//
function clausenum(clausetext) {
  return clausetext2num[clausetext] || hintclause2num[clausetext] || "<<CLAUSE XREF MISSING>>";
}
  
// ---------------------------------------------------------------------------------------------------------------- showclause
function showclause_(clausetext) {
    return clausenum + " (" + clausetext + ")";
}


// ---------------------------------------------------------------------------------------------------------------- quicktest
function quicktest() {
 var ss = SpreadsheetApp.getActiveSpreadsheet();
 var triggers = ScriptApp.getUserTriggers(ss);

 // Log the event type for the first trigger in the array.
 Logger.log("my triggers are: " + triggers);
  for (var i in triggers) {
	var t = triggers[i];
	Logger.log("trigger " + i + " is: " + t + " which has event type " + t.getEventType());
  }
}

/** Template generation is as follows:
  *
  * open up the configuring sheet
  * read the configuring sheet. It tells us which templates exist, and a little bit about those templates.
  * filter the templates, excluding all those which are not suitable for the current configuration.
  * 
  * create a new folder
  * for each suitable template, load the source HTML
  * fill in the HTML template
  * convert the HTMLOutput into Google Docs native
  * put the google docs document into the new folder
  * 
  */

// ---------------------------------------------------------------------------------------------------------------- availableTemplates_
function availableTemplates_() {
    // return a bunch of URLs
  var availables = [
//  { url:"test1.html", title:"Test One" },

  { url:"loan_waiver_xml", title:"Waiver of Convertible Loan" },

// for digify
  { url:"dora_xml", title:"DORA" },
  { url:"kiss_amendment_xml", title:"DORA" },
  { url:"kiss_amendment", title:"Kiss Amendment" },
  { url:"test", title:"Test 1", investors:"onebyone" },
  { url:"termsheet", title:"Convertible Note Termsheet" },
  { url:"darius",    title:"Convertible Note Agreement" },
  { url:"kissing",   title:"KISS(Sing) Agreement" },
  ];
return availables;
};

// ---------------------------------------------------------------------------------------------------------------- desiredTemplates_
function desiredTemplates_(config) {
  var toreturn = [];
  for (var i in config.templates.dict) {
	var field = asvar_(i);
	toreturn.push(field);
  }
  Logger.log("desiredTemplates_: returning %s", toreturn);
  return toreturn;
}

// ---------------------------------------------------------------------------------------------------------------- intersect_
// yes, this is O(nm) but for small n,m it should be OK
function intersect_(array1, array2) {
  return array1.filter(function(n) { return array2.indexOf(n.url) != -1 || array2.indexOf(n.url.replace(/_xml/,"")) != -1 });
}

// ---------------------------------------------------------------------------------------------------------------- fillTemplates
function fillTemplates() {
  var templatedata = readRows_();
  templatedata.clauses = {};

  var folder = createFolder_(); var readme = createReadme_(folder);
  PropertiesService.getUserProperties().setProperty("legalese.folder.id", JSON.stringify(folder.getId()));
  Logger.log("fillTemplates: property set legalese.folder.id = %s", folder.getId());

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Deal Terms");
  var cell = sheet.getRange("E6");
  cell.setValue("=HYPERLINK(\""+folder.getUrl()+"\",\""+folder.getName()+"\")");

  var config = readConfig();

  var availables = availableTemplates_();
  var desireds = desiredTemplates_(config);
  var suitables = intersect_(availables, desireds);

  Logger.log("resolved suitables = %s", suitables.map(function(e){return e.url}).join(", "));

  templatedata.company = templatedata.parties.company[0];
  templatedata.founders = templatedata.parties.founder;

  for (var i in suitables) {
    var sourceTemplate = suitables[i];
    var url = sourceTemplate.url;
    var newTemplate = HtmlService.createTemplateFromFile(url);
    newTemplate.data = templatedata;
	var sans_xml = url.replace(/_xml|xml_/,"");

	// TODO: respect the "all in one doc" vs "one per doc" for all categories not just investors

    var investors = templatedata.parties.investor;
	var explosion;
	try { explosion = config.templates.tree[sans_xml].Investor } catch (e) { Logger.log("explosion exploded"); }
	if (explosion == "all in one doc") {
	  Logger.log("doing investors all in one doc ... " + sourceTemplate.url);
	  fillTemplate_(newTemplate, sourceTemplate, sourceTemplate.title, folder);
	}
	else {
	  Logger.log("doing investors one per doc ... " + sourceTemplate.url);
      for (var j in investors) {
		// we step through the multiple data.parties.{founder,investor,company}.* arrays.
		// we set the singular as we step through.
		newTemplate.data.investor = investors[j];
		var mytitle = sourceTemplate.title + " for " + templatedata.investor.name;
		Logger.log("starting " + mytitle);
		fillTemplate_(newTemplate, sourceTemplate, mytitle, folder);
	  }
    }
	Logger.log("finished suitable %s", url);
  }
  Logger.log("that's all folks!");
};

// ---------------------------------------------------------------------------------------------------------------- fillTemplate_
// fill a single template -- inner-loop function for fillTemplates() above.
function fillTemplate_(newTemplate, sourceTemplate, mytitle, folder) {
  // reset "globals"
  clauseroot = [];
  clausetext2num = {};
  var filledHTML = newTemplate.evaluate().setSandboxMode(HtmlService.SandboxMode.IFRAME).getContent();
  var htmlfile;

  if (sourceTemplate.url.match(/^xml|xml$/)) {
	htmlfile = DriveApp.createFile(mytitle+".xml", filledHTML, 'text/xml');
  }
  else {
	htmlfile = DriveApp.createFile(mytitle+".html", filledHTML, 'text/html');
	var blob = htmlfile.getBlob();
	var resource = { title: mytitle, convert: true, mimeType: 'application/vnd.google-apps.document' };
	var drive_file = Drive.Files.insert(resource,blob);  // advanced Drive API
	var docs_file = DriveApp.getFileById(drive_file.id); // regular Drive API
	resetStyles_(DocumentApp.openById(drive_file.id));   // regular DocumentApp API
	folder.addFile(docs_file);                          

	// in the future we will probably need several subfolders, one for each template family.
	// and when that time comes we won't want to just send all the PDFs -- we'll need a more structured way to let the user decide which PDFs to send to echosign.
  }

  folder.addFile(htmlfile);
  Logger.log("finished " + mytitle);
}

// ---------------------------------------------------------------------------------------------------------------- legaleseRootFolder_
function legaleseRootFolder_() {
  var legaleses = DriveApp.getFoldersByName("Legalese Root");
  var legalese_root;
  Logger.log("legaleses = " + legaleses);
  if (legaleses.hasNext()) {
	Logger.log("legaleses is defined");
	legalese_root = legaleses.next();
	Logger.log("legalese_root = " + legalese_root);
  } else {
	legalese_root = DriveApp.createFolder("Legalese Root");
  }
  PropertiesService.getUserProperties().setProperty("legalese.rootfolder", JSON.stringify(legalese_root.getId));
  return legalese_root;
}

// ---------------------------------------------------------------------------------------------------------------- createFolder_
function createFolder_() {
  var legalese_root = legaleseRootFolder_();
  Logger.log("attempting createfolder");
  var folder = legalese_root.createFolder(SpreadsheetApp.getActiveSpreadsheet().getName() + " "
										  + Utilities.formatDate(new Date(), SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(), "yyyyMMdd-HHmmss"));
  Logger.log("createfolder returned " + folder);

  legalese_root.addFile(DriveApp.getFileById(SpreadsheetApp.getActiveSpreadsheet().getId()));

  return folder;
};

// ---------------------------------------------------------------------------------------------------------------- createReadme_
function createReadme_(folder) { // under the parent folder
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var doc = DocumentApp.create("README for " + spreadsheet.getName());
  folder.addFile(DriveApp.getFileById(doc.getId()));
  doc.getBody().appendParagraph("this was created by Legalese.");
  Logger.log("run started");
  return doc;
}

// ---------------------------------------------------------------------------------------------------------------- resetStyles_
function resetStyles_(doc) {
  var body = doc.getBody();

  var listitems = body.getListItems();
  for (var p in listitems) {
    var para = listitems[p];
    var atts = para.getAttributes();
    atts.INDENT_START = 36;
    atts.INDENT_FIRST_LINE = 18;
    para.setAttributes(atts);
  }
}

// ---------------------------------------------------------------------------------------------------------------- showStyleAttributes
function showStyleAttributes() {
  var body = DocumentApp.getActiveDocument.getBody();
  var listitems = body.getListItems();
  for (var p in listitems) {
    var para = listitems[p];
    var atts = para.getAttributes();
    for (i in atts) {
      para.appendText("attribute " + i + " = " + atts[i]);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------- resetUserProperties
// utility function to reset userproperties
function resetUserProperties(which) {
  var userP = PropertiesService.getUserProperties();
  if (which == "all") userP.deleteAllProperties();
  else userP.deleteProperty(which);
}

// ---------------------------------------------------------------------------------------------------------------- getEchoSignService
// oAuth integration with EchoSign
// EchoSign uses OAuth 2
// so we grabbed https://github.com/googlesamples/apps-script-oauth2
// and we turned on the library.
//
// the redirect url is https://script.google.com/macros/d/{PROJECT KEY}/usercallback



function getEchoSignService() {
  // Create a new service with the given name. The name will be used when 
  // persisting the authorized token, so ensure it is unique within the 
  // scope of the property store.
  var toreturn = OAuth2.createService('echosign')

      // Set the endpoint URLs
      .setAuthorizationBaseUrl('https://secure.echosign.com/public/oauth')
      .setTokenUrl('https://secure.echosign.com/oauth/token')
      // Set the name of the callback function in the script referenced 
      // above that should be invoked to complete the OAuth flow.
      .setCallbackFunction('authCallback')

      // Set the property store where authorized tokens should be persisted.
      .setPropertyStore(PropertiesService.getUserProperties())

      // Set the scopes to request (space-separated for Google services).
      .setScope('agreement_read agreement_send agreement_write user_login');

  var ssname = SpreadsheetApp.getActiveSpreadsheet().getName();

  var esApps = {
	"Digify KISS Amendment" : { clientId:"B7ANAKXAX94V6P", clientSecret:"417e13ac801250d2146892eb0266d16e", projectKey:"MYzWng6oYKb0nTSoDTQ271cUQWaHMB8in" },
	"Waiver of Convertible Loan" : { clientId:"B8WRFA45X5727E", clientSecret:"0ef004d92582af21ceda0ee94e8ba5c2", projectKey:"M8Z8igDQBcgVeVy1AdAskyHYH5ITXFjPS" },
	"JFDI.2014 Deed of Ratification and Accession" : { clientId:"B7ANAKXAX94V6P", clientSecret:"417e13ac801250d2146892eb0266d16e", projectKey:"MYzWng6oYKb0nTSoDTQ271cUQWaHMB8in" },
  "default" : { clientId:"B9HLGY92L5Z4H5", clientSecret:"ff4c883e539571273980245c41199b70", projectKey:"M6VMONjB762l0FdR-z7tWO3YH5ITXFjPS" },
  };

  if (esApps[ssname] == undefined) { ssname = "default" }

  toreturn
      // Set the client ID and secret
      .setClientId(esApps[ssname].clientId)
      .setClientSecret(esApps[ssname].clientSecret)
  // from https://secure.echosign.com/account/application -- do this as a CUSTOMER not a PARTNER application.
      .setProjectKey(esApps[ssname].projectKey);

// see https://secure.echosign.com/public/static/oauthDoc.jsp#scopes
  toreturn.APIbaseUrl = 'https://secure.echosign.com/api/rest/v2';

//   var oAuthConfig = UrlFetchApp.addOAuthService("echosign");
//   oAuthConfig.setAccessTokenUrl(toreturn.tokenUrl_);
//   oAuthConfig.setRequestTokenUrl(toreturn.tokenUrl_);
//   oAuthConfig.setAuthorizationUrl(toreturn.tokenUrl_);
//   oAuthConfig.setConsumerKey(toreturn.clientId_);
//   oAuthConfig.setConsumerSecret(toreturn.clientSecret_);

  return toreturn;
}
 
// ---------------------------------------------------------------------------------------------------------------- showSidebar
function showSidebar() {
  var echosignService = getEchoSignService();
  if (!echosignService.hasAccess()) {
    var authorizationUrl = echosignService.getAuthorizationUrl();
    var template = HtmlService.createTemplate(
        '<a href="<?= authorizationUrl ?>" target="_blank">Authorize EchoSign</a>. ' +
//		'sending you to ' + authorizationUrl +
        'Close this sidebar when authorization completes.');
    template.authorizationUrl = authorizationUrl;
    var page = template.evaluate();
	page
      .setSandboxMode(HtmlService.SandboxMode.IFRAME)
      .setTitle('OAuth to EchoSign')
      .setWidth(300);
	SpreadsheetApp.getUi() // Or DocumentApp or FormApp.
      .showSidebar(page);

  } else {
    // we already have echosign access
//	var ui = SpreadsheetApp.getUi(); // Same variations.
//	ui.alert("we already have OAuth access to EchoSign.");
  }
}

// ---------------------------------------------------------------------------------------------------------------- authCallback
function authCallback(request) {
  var echosignService = getEchoSignService();
  var isAuthorized = echosignService.handleCallback(request);
  if (isAuthorized) {
    return HtmlService.createHtmlOutput('Success! You can close this tab.\nBTW the token property is ' +  PropertiesService.getUserProperties().getProperty("oauth2.echosign"));
  } else {
    return HtmlService.createHtmlOutput('Denied. You can close this tab.');
  }
}

function getLibraryDocuments() {
  var api = getEchoSignService();
  var response = UrlFetchApp.fetch(api.APIbaseUrl + '/libraryDocuments',
								   { headers: { "Access-Token": api.getAccessToken() } });

  SpreadsheetApp.getUi().alert(response.getContentText());
}

function allPDFs(folder) {
  var folders = folder.getFolders();
  var files = folder.getFilesByType("application/pdf");
  var pdfs = [];
  while (  files.hasNext()) { pdfs= pdfs.concat(          files.next());  }
  while (folders.hasNext()) { pdfs= pdfs.concat(allPDFs(folders.next())); }
  Logger.log("all PDFs under folder = %s", pdfs);
  return pdfs;
}

// ---------------------------------------------------------------------------------------------------------------- uploadPDFsToEchoSign
// upload all the PDFs in the Folder
// returns an array of the transientDocumentIds of all the PDFs uploaded to Echosign.
function uploadPDFsToEchoSign() {
  var api = getEchoSignService();
  var o = { headers: { "Access-Token": api.getAccessToken() } };
  o.method = "post";

  var folderId = JSON.parse(PropertiesService.getUserProperties().getProperty("legalese.folder.id"));
  Logger.log("uploadPDFsToEchoSign: property get legalese.folder.id = %s", folderId);
  if (folderId == undefined) {
	SpreadsheetApp.getUi().alert("Not sure which folder contains PDFs.\nPlease regenerate documents by clicking Legalese / Generate Docs");
	return;
  }
  var folder = DriveApp.getFolderById(folderId);
  var pdfs = allPDFs(folder);
  var toreturn = [];
  for (var i in pdfs) {
	var pdfdoc = pdfs[i];

	o.payload = {
	  "File-Name": pdfdoc.getName(),
	  "File":      pdfdoc.getBlob(),
	  "Mime-Type": pdfdoc.getMimeType(), // we assume that's application/pdf
	};

	Logger.log("uploading to EchoSign as a transientDocument: %s %s", pdfdoc.getId(), pdfdoc.getName());
	if (o.payload['Mime-Type'] != "application/pdf") {
	  Logger.log("WARNING: mime-type of document %s (%s) is not application/pdf ... weird, eh.", pdfdoc.getId(), pdfdoc.getName());
	}

	var response = UrlFetchApp.fetch(api.APIbaseUrl + '/transientDocuments', o);
	var r = JSON.parse(response.getContentText());
	Logger.log("uploaded %s (%s) as transientDocumentId=%s", pdfdoc.getId(), pdfdoc.getName(), r.transientDocumentId);

	toreturn.push(r.transientDocumentId);
  }

  return toreturn;
}

// ---------------------------------------------------------------------------------------------------------------- showUserProperties
function showUserProperties() {
  Logger.log("userProperties: %s", JSON.stringify(PropertiesService.getUserProperties().getProperties()));
  Logger.log("scriptProperties: %s", JSON.stringify(PropertiesService.getScriptProperties().getProperties()));
}  

// ---------------------------------------------------------------------------------------------------------------- createLegaleseStatusColumn
function createLegaleseStatusColumn(readrows) {
  var partyfields = readrows._origpartyfields;
  var fieldnames  = partyfields.map(function(e){return e.fieldname});
  var last_filled_column = readrows._parties_last_filled_column;
  var first_party_row = readrows._first_party_row;
  var last_party_row = readrows._last_party_row;
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Deal Terms");

  Logger.log("fieldnames = %s", fieldnames);

  var range;
  if (fieldnames.indexOf("Legalese Status") != -1) {
	Logger.log("we already have a Legalese Status column -- column %s", fieldnames.indexOf("Legalese Status")+1);
	Logger.log("getRange(%s,%s,%s,%s)", 
			   first_party_row+1, fieldnames.indexOf("Legalese Status")+1, last_party_row-first_party_row+1, 1);
	range = sheet.getRange(first_party_row+1, fieldnames.indexOf("Legalese Status")+1, last_party_row-first_party_row+1, 1);
	Logger.log("got back range %s", range);
  }
  else {
	//TODO -- maybe we just DONTDO and mandate that the original spreadsheet just has to have this column already!
	Logger.log("we shall have to add a Legalese Status column after %s", last_filled_column);
	// move the range one column to the right
	Logger.log("we shall move a range within rows %s to %s starting with column %s", first_party_row, last_party_row, last_filled_column+1);
	// use range.getLastColumn() to do something intelligent here.
	var cell = sheet.getRange(first_party_row, last_filled_column+1, 1, 1);
	cell.setValue("Legalese Status");
	// and add the corret things to the above also
	partyfields.push({fieldname:"Legalese Status"});
	range = sheet.getRange(first_party_row, partyfields.length-1, last_party_row-first_party_row, 1);
  }
  Logger.log("returning column range %s", JSON.stringify(range));
  return range;
}
  

// ---------------------------------------------------------------------------------------------------------------- uploadAgreement
// send PDFs to echosign.
// if the PDFs don't exist, send them to InDesign for creation and wait.
// for extra credit, define a usercallback and associate it with a StateToken so InDesign can proactively trigger a pickup.
// for now, just looking for the PDFs in the folder seems to be good enough.
function uploadAgreement() {
  var readrows = readRows_();
  var config = readConfig();
  var parties = readrows.parties;
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Deal Terms");
  var transientDocumentIds = uploadPDFsToEchoSign();
  var emailInfo = [];

  // does the spreadsheet have a "Legalese Status" field?
  // if not, create a column in the spreadsheet, to the right of the rightmost filled column.
  var statusRange = createLegaleseStatusColumn(readrows);

  var now = Utilities.formatDate(new Date(), SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(), "yyyyMMdd-HHmmss");
  
  // update the party's Legalese Status cell to indicate we've sent the mail.
  
  for (var p in parties._unmailed) {
	var party = parties._unmailed[p];
	  emailInfo.push({email:party.email, role:"SIGNER"});
	  getPartyCells_(sheet, readrows, party).legalesestatus.setValue("mailed echosign " + now);
  }
  Logger.log("we shall be emailing to %s", emailInfo);

  if (emailInfo.length == 0) {
	SpreadsheetApp.getUi().alert("There doesn't seem to be anybody for us to mail this to! Check the Legalese Status column.");
	return;
  }

  // TODO: who shall we cc to? everybody whose legalese status == "cc".
  var cc_list = parties._allparties.filter(function(party){return party.legalesestatus=="cc"});
  for (var p in cc_list) {
	var party = cc_list[p];
	getPartyCells_(sheet, readrows, party).legalesestatus.setValue("CC'ed echosign " + now);
  }
  cc_list = cc_list.map(function(party){return party.email});

  Logger.log("To: %s", emailInfo.map(function(party){return party.email}));
  Logger.log("CC: %s", cc_list);

  var ss = SpreadsheetApp.getActiveSpreadsheet();

  for (var i in transientDocumentIds) {
	var transientDocumentId = transientDocumentIds[i];
	Logger.log("turning transientDocument %s into an agreement", transientDocumentId);

	// continue;
	var acr = postAgreement_(	{ "transientDocumentId": transientDocumentId },
								emailInfo,
								"Please sign and return. If in doubt please contact "
								+ parties.company[0].email,
								ss.getName(),
								cc_list
	);

	Logger.log("uploadAgreement: well, that seems to have worked!");

	var cell = ss.getSheetByName("Deal Terms").getRange("E8");
	cell.setValue("=HYPERLINK(\""+acr.url+"\",\"EchoSign\")")
  }

	Logger.log("uploadAgreement: that's all, folks!");
}

function postAgreement_(fileInfos, recipients, message, name, cc_list, agreementCreationInfo) {
  var api = getEchoSignService();

  if (agreementCreationInfo == undefined) {
	agreementCreationInfo = {
	  "documentCreationInfo": {
		"signatureType": "ESIGN",
		"recipients": recipients,
		"daysUntilSigningDeadline": "3",
		"ccs": cc_list , // everyone whose legalese status is cc
		"signatureFlow": "PARALLEL", // only available for paid accounts. we may need to check the user info and switch this to SENDER_SIGNATURE_NOT_REQUIRED if the user is in the free tier.
		"message": message,
		"fileInfos": fileInfos,
		"name": name,
	  },
	  "options": {
		"authoringRequested": false,
	  }
	};
  }

  var o = { headers: { "Access-Token": api.getAccessToken() },
			method: "post",
		  };
//  o.oAuthServiceName = "echosign";
//  o.oAuthUseToken = "always";

// this works in the postTransientDocument, but doesn't work here. how weird!
// see https://developers.google.com/apps-script/reference/url-fetch/url-fetch-app
//  o.payload = agreementCreationInfo;

  o.contentType = 'application/json';
  o.payload = JSON.stringify(agreementCreationInfo);
// this is fucked up. we shouldn't have to do this manually.
// in postTransientDocument I don't have to. what a huge mystery!
// https://developers.google.com/apps-script/reference/url-fetch/url-fetch-app

  Logger.log("about to dump %s", JSON.stringify(o));

  var response = UrlFetchApp.fetch(api.APIbaseUrl + '/agreements', o);

  if (response.getResponseCode() >= 400) {
	Logger.log("got response %s", response.getContentText());
	Logger.log("dying");
	return;
  }

  Logger.log("got back %s", response.getContentText());

  return JSON.parse(response.getContentText());
}

// {
//     "documentCreationInfo": {
//         "name": "TODO: name of the agreement",
//         "message": "TODO: an appropriate message to the recipient",
//         "recipients": [
//             {
//                 "email": "TODO: recipient's email ID",
//                 "role": "TODO: recipient's role (SIGNER/APPROVER)"
//             }
//         ],
//         "signatureType": "TODO: a valid value for signature type (ESIGN/WRITTEN)",
//         "signatureFlow": "TODO: a valid value for signature flow (SENDER_SIGNS_LAST/SENDER_SIGNS_FIRST/SENDER_SIGNATURE_NOT_REQUIRED/SEQUENTIAL)",
//         "securityOptions": {
//             "passwordProtection": "NONE",
//             "kbaProtection": "NONE",
//             "webIdentityProtection": "NONE",
//             "protectOpen": "false",
//             "internalPassword": "",
//             "externalPassword": "",
//             "openPassword": ""
//         }
//     }
// }

  
function mylogger(input) {
  Logger.log(input);
}
// TODO:
// data.parties._investor_plural
// how many parties are there in all of the investors? if there's only one investor and it's a natural person then the answer is 1.
// otherwise the answer is probably plural.
// used by the convertible_loan_waiver.

