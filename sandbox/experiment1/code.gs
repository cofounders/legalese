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
  { name:"Generate Docs", functionName:"fillTemplates_"},
  { name:"quicktest_", functionName:"quicktest_"},
  ];
    spreadsheet.addMenu("Legalese", entries);
	// when we release this as an add-on the menu-adding will change.
};


// ---------------------------------------------------------------------------------------------------------------- setupForm
/**
 * establish a form for investors to fill in their personal details
 */
function setupForm_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var cell = ss.getSheetByName("Deal Terms").getRange("F4");

  var form = ss.getFormUrl();
  Logger.log("starting readRows_()");
  var data = readRows_();
  Logger.log("finished readRows_()");

  if (form != undefined) {
    var ui = SpreadsheetApp.getUi();
    var response = ui.prompt('An investor form was previously created.', 'Reset it?', ui.ButtonSet.YES_NO);

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
	form = FormApp.create('Investor Form')
      .setDescription('Please fill in investor details for the proposed investment in ' + data.parties.company[0].name + ".")
      .setConfirmationMessage('Thanks for responding!')
      .setAllowResponseEdits(true)
      .setAcceptingResponses(true)
	  .setProgressBar(true);
	ScriptApp.newTrigger('onFormSubmit').forSpreadsheet(ss).onFormSubmit().create();
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
	  // in the future, when Google Apss Scripts adds validation to its FormApp, validate the input as a valid email address or number as appropriate.
	}
	else if (partyfield.itemtype.match(/^text/)) {
	  form.addTextItem()
		.setTitle(partyfield.fieldname)
		.setRequired(partyfield.required)
		.setHelpText(partyfield.helptext);
	}	  
  }
  var form_url = form.getPublishedUrl();
  var short_url = form.shortenFormUrl(form_url);

  cell.setValue(short_url); SpreadsheetApp.flush();
}

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
  var cell = sheet.getRange("H4");
  // add a row and insert the investor fields
  sheet.insertRowAfter(data._last_party_row+1); // might need to update the commitment sum range
  var newrow = sheet.getRange(data._last_party_row+2,1,1,sheet.getMaxColumns());
//  newrow.getCell(0,0).setValue("bar");
  newrow.getCell(1,1).setValue("Investor:");
  newrow.getCell(1,3).setValue("investor");

  var origpartyfields = data._origpartyfields;
  Logger.log("onFormSubmit: origpartyfields = " + origpartyfields);
  // loop through the origpartyfields inserting the new data in the right place.
  for (names in e.namedValues) {
	Logger.log("e.namedValues = " + names + ":"+e.namedValues[names][0]);
  }
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
 * the PARTIES go into data.parties.founder.*, data.parties.shareholder.*, data.parties.company.*, data.parties.investor.* as arrays
 * the TERMS go into data.* directly.
 * if a suitabletemplate is marked as binary then we iterate through the investors and set data.investor.* each time
 */
function readRows_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Deal Terms");
  var rows = sheet.getDataRange();
  var numRows = rows.getNumRows();
  var values = rows.getValues();
  var terms = {};
  var section = "prologue";
  var partyfields = [];
  var origpartyfields = [];
  var partyfieldorder = []; // table that remaps column number to order-in-the-form
  var parties = { founder:[], shareholder:[], company:[], investor:[] };
  var terms_row_offset;

  Logger.log("readRows_(): starting.");

// get the formats for the B column -- else we won't know what currency the money fields are in.
  var term_formats = sheet.getRange(1,2,numRows).getNumberFormats();

  for (var i = 0; i <= numRows - 1; i++) {
    var row = values[i];

	Logger.log("row " + i + ": processing row "+row[0]);
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
																				  Logger.log("learned that field with order "+row[ki]+ " is in column " +origpartyfields[partyfieldorder[ki]].column);
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
																					 Logger.log("line "+i+" col "+ki+": learned that field with order "+partyfieldorder[ki]+ " has required="+row[ki]);
																					 origpartyfields[partyfieldorder[ki]].required = row[ki];
																				   }
											continue;
										  }
    else if (row[0] == "PARTIES")   {
	  section = row[0]; partyfields = row;
      for (var ki in partyfields) {
		if (ki < 1 || row[ki] == undefined || row[ki] == "partygroup") { continue }
        origpartyfields[partyfieldorder[ki]] = origpartyfields[partyfieldorder[ki]] || {};
        origpartyfields[partyfieldorder[ki]].fieldname = row[ki];
		Logger.log("learned origpartyfields["+partyfieldorder[ki]+"].fieldname="+row[ki]);
        partyfields[ki] = partyfields[ki].toLowerCase().replace(/\s+/g, ''); Logger.log("got partyfield " + partyfields[ki]);
      }
      continue;
	}

	// process data rows
    if (section == "KEY TERMS") {
      if (row[2] == undefined || row[2].length == 0) { continue }
//      Logger.log("expanding term " + row[1] + " with format " + term_formats[i][0]);
      terms[row[2]] = formatify_(term_formats[i][0], row[1]);
    }
    else if (section == "PARTIES") { // Name	partygroup	Email	IDtype	ID	Address	State	InvestorType Commitment etc
      var singleparty = {};
      var party_formats = sheet.getRange(i+1,1,1,row.length).getNumberFormats();

      for (var ki in partyfields) {
        if (ki < 1) { continue }
        var k = partyfields[ki];
        var v = formatify_(party_formats[0][ki],row[ki]);

//        Logger.log("learned %s.%s=%s", row[2], k, v);
        singleparty[k] = v;
      }
      var partytype = row[2];
	  if (partytype == undefined || ! partytype.length) { continue }

      Logger.log("learning entire %s, %s", partytype, singleparty);
      parties[partytype].push(singleparty);
	  terms._last_party_row = i;
    }
  }
  terms._origpartyfields = origpartyfields;
  terms.parties = parties;
  return terms;
};

// ---------------------------------------------------------------------------------------------------------------- formatify_
// Wed Dec 17 05:17:57 PST 2014 INFO: term 150000 has format [$S$]#,##0
// Wed Dec 17 05:17:57 PST 2014 INFO: term 2500000 has format [$$]#,##0.00
// Wed Dec 17 05:17:57 PST 2014 INFO: term All has format 0.###############
// Wed Dec 17 05:17:57 PST 2014 INFO: term 0.02 has format 0.00%
// Wed Dec 17 05:17:57 PST 2014 INFO: term 36 months has format 0.###############
// Wed Dec 17 05:17:57 PST 2014 INFO: term 2000000 has format [$SGD $]#,##0.00
// Wed Dec 17 05:17:57 PST 2014 INFO: term 0.2 has format 0%

// google's raw format expresses 1% as 0.01.
//  var percent_terms = ["interest", "conversion_discount_percent", "maturity_conversion_discount_percent"];
//  for (var i in percent_terms) { templatedata[percent_terms[i]] *= 100; }
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

// ---------------------------------------------------------------------------------------------------------------- newclause_
var clauseroot = [];
var clausetext2num = {};
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
	return "<style>#"+myid+":before { display:block; content: \"" + pathindex.join(".") + ". \" } </style>" + "<li id=\"" + myid + "\">";
  } else {
      return "<h"+(level+0)+">"+pathindex.join(".") + ". " + clausetext + "</h"+(level+0)+">";
  }
}

// ---------------------------------------------------------------------------------------------------------------- clausenum_
function clausenum(clausetext) {
  return clausetext2num[clausetext] || "<<CLAUSE XREF MISSING>>";
}
  
// ---------------------------------------------------------------------------------------------------------------- showclause_
function showclause_(clausetext, clausenumber, data) {
    data.clauses[clausenumber] = { text: clausetext, children: {} };
    return clausenumber + ". " + clausetext;
}

// ---------------------------------------------------------------------------------------------------------------- quicktest_
function quicktest_() {
  var ui = SpreadsheetApp.getUi(); // Same variations.
//  var mystring = formatify_($ ", 1000000.01);
  var mystring = formatify_("[$S$]#,###,##0.00",500000000000);
  ui.alert(mystring);
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

// ---------------------------------------------------------------------------------------------------------------- fillTemplates_
function fillTemplates_() {
  var templatedata = readRows_();
  templatedata.clauses = {};

  var folder = createFolder_(); var readme = createReadme_(folder);

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Deal Terms");
  var cell = sheet.getRange("F6");
  var suitables = suitableTemplates_();
  cell.setValue(folder.getUrl());

  templatedata.company = templatedata.parties.company[0];
  templatedata.founders = templatedata.parties.founder;

  for (var i in suitables) {
    var sourceTemplate = suitables[i];
    var url = sourceTemplate.url;
    var newTemplate = HtmlService.createTemplateFromFile(url);

    var investors = templatedata.parties.investor;
    templatedata.shareholders = templatedata.parties.shareholder;

    for (var j in investors) {
      // we step through the multiple data.parties.{founder,investor,company}.* arrays.
      // we set the singular as we step through.
      templatedata.investor = investors[j];
      newTemplate.data = templatedata;
      
      var mytitle = sourceTemplate.title + " for " + templatedata.investor.name;
      Logger.log("started " + mytitle);

// reset "globals"
clauseroot = [];
clausetext2num = {};
      var filledHTML = fillTemplate_(newTemplate);
      var htmlfile = DriveApp.createFile(mytitle+".html", filledHTML, 'text/html');
      var blob = htmlfile.getBlob();
      var resource = { title: mytitle, convert: true, mimeType: 'application/vnd.google-apps.document' };
      var drive_file = Drive.Files.insert(resource,blob);
      var docs_file = DriveApp.getFileById(drive_file.id);
// in the future we will probably need several subfolders, one for each template family.
      folder.addFile(docs_file);
      folder.addFile(htmlfile);
      var file = DocumentApp.openById(drive_file.id);
      resetStyles_(file);
      Logger.log("finished " + mytitle);
    }
  }
};

// ---------------------------------------------------------------------------------------------------------------- readConfigSheet_
function readConfigSheet_() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = spreadsheet.getSheetByName("Templates"); // get sheet named Templates
  return sheet;
};

// ---------------------------------------------------------------------------------------------------------------- suitableTemplates_
function suitableTemplates_() {
  var configSheet = readConfigSheet_();
    // return a bunch of URLs
  var suitables = [
//  { url:"test1.html", title:"Test One" },
// investors: onebyone | all
// 

  { url:"termsheet.html", title:"Convertible Note Termsheet", investors:"onebyone" },
  { url:"darius.html",    title:"Convertible Note Agreement", investors:"onebyone" },
  { url:"kissing.html",   title:"KISS(Sing) Agreement",       investors:"onebyone" },
  ];
return suitables;
};

// ---------------------------------------------------------------------------------------------------------------- createFolder_
function createFolder_() {
  var folder = DriveApp.getFolderById("0BxOaYa8pqqSwOEVtdlJ1Z3hkZkU");
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

// ---------------------------------------------------------------------------------------------------------------- fillTemplate_
function fillTemplate_(template) {
    var output = template.evaluate().setSandboxMode(HtmlService.SandboxMode.IFRAME);
    return output.getContent();
};

// ---------------------------------------------------------------------------------------------------------------- searchAndReplace_
function searchAndReplace_() {
  var body = DocumentApp.getActiveDocument()
      .getBody();
  var client = {
    name: 'Joe Script-Guru',
    address: '100 Script Rd',
    city: 'Scriptville',
    state: 'GA',
    zip: 94043
  };

  body.replaceText('{name}', client.name);
  body.replaceText('{address}', client.address);
  body.replaceText('{city}', client.city);
  body.replaceText('{state}', client.state);
  body.replaceText('{zip}', client.zip);
};


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
