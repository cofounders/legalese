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
  { name:"quicktest", functionName:"quicktest"},
  { name:"delete extra triggers", functionName:"delete_all_but_one_trigger"},
  ];
    spreadsheet.addMenu("Legalese", entries);
	// when we release this as an add-on the menu-adding will change.
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
// config.columna.dict is a dictionary of c: [d,e,f] across multiple lines

function readConfig() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("README");

  var rows = sheet.getDataRange();
  var numRows = rows.getNumRows();
  var values = rows.getValues();
  var section = "prologue";

  var config = {};
  var previous_columna;

  for (var i = 0; i <= numRows - 1; i++) {
    var row = values[i];

	// process header rows
	if (row[0] == "CONFIGURATION") { section = row[0]; continue }
	if (section == "CONFIGURATION") {
	  if (row[1] == undefined) { continue }
	  Logger.log("row " + i + ": processing row "+row[0]);

	  var columna = asvar_(row[0]) || previous_columna;
	  previous_columna = columna;

	  Logger.log("columna="+columna);
	  config[columna] = config[columna] || { asRange:null, values:null, dict:{} };

	  Logger.log("config[columna]="+config[columna]);

	  config[columna].asRange = sheet.getRange(i+1,2,1,sheet.getMaxColumns());
	  Logger.log(columna+".asRange=" + config[columna].asRange.getValues()[0].join(","));

	  config[columna].values = config[columna].asRange.getValues()[0];
	  while (config[columna].values[config[columna].values.length-1] === "") { config[columna].values.pop() }

	  Logger.log(columna+".values=" + config[columna].values.join(","));

	  var columns_def = config[columna].values.slice(0);
	  if (columns_def[0] == undefined) { continue }
	  var columnc = asvar_(columns_def.shift());

	  while (columns_def[columns_def.length-1] === "") { columns_def.pop() }

	  config[columna].dict[columnc] = columns_def;
	  Logger.log(columna+".dict."+columnc+"=" + config[columna].dict[columnc].join(","));
	}
  }
  Logger.log("returning\n" + JSON.stringify(config,null,"  "));
  return config;
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
  var parties = { founder:[], existing_shareholder:[], company:[], investor:[] };
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
      if ( row[0].length == 0) { continue }
      terms[asvar_(row[0])] = formatify_(term_formats[i][0], row[1]);
    }
    else if (section == "PARTIES") { // Name	partygroup	Email	IDtype	ID	Address	State	InvestorType Commitment etc
      var singleparty = {};
      var party_formats = sheet.getRange(i+1,1,1,row.length).getNumberFormats();

      for (var ki in partyfields) {
        if (ki < 1) { continue }
        var k = partyfields[ki];
        var v = formatify_(party_formats[0][ki],row[ki]);

        singleparty[k] = v;
      }
      var partytype = asvar_(row[0]);
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


function delete_all_but_one_trigger() {
 var ss = SpreadsheetApp.getActiveSpreadsheet();
 var triggers = ScriptApp.getUserTriggers(ss);

 // Log the event type for the first trigger in the array.
 for (var i = 1; i < triggers.length; i++) {
   ScriptApp.deleteTrigger(triggers[i]);
 }
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

// ---------------------------------------------------------------------------------------------------------------- fillTemplates_
function fillTemplates_() {
  var templatedata = readRows_();
  templatedata.clauses = {};

  var folder = createFolder_(); var readme = createReadme_(folder);

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Deal Terms");
  var cell = sheet.getRange("E6");
  var suitables = suitableTemplates_();
  cell.setValue("=HYPERLINK(\""+folder.getUrl()+"\",\""+folder.getName()+"\")");

  templatedata.company = templatedata.parties.company[0];
  templatedata.founders = templatedata.parties.founder;

  for (var i in suitables) {
    var sourceTemplate = suitables[i];
    var url = sourceTemplate.url;
    var newTemplate = HtmlService.createTemplateFromFile(url);

    var investors = templatedata.parties.investor;
    templatedata.existing_shareholders = templatedata.parties.existing_shareholder;

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
	  }

	  folder.addFile(htmlfile);
      Logger.log("finished " + mytitle);
    }
  }
};

// ---------------------------------------------------------------------------------------------------------------- suitableTemplates_
function suitableTemplates_() {
    // return a bunch of URLs
  var suitables = [
//  { url:"test1.html", title:"Test One" },
// investors: onebyone | all
// 
  { url:"xml_founderagreement", title:"Founder Agreement 1 XML", investors:"onebyone", founders:"together" },
  { url:"founderagreement", title:"Founder Agreement 1", investors:"onebyone", founders:"together" },
//   { url:"test", title:"Test 1", investors:"onebyone" },
//   { url:"termsheet", title:"Convertible Note Termsheet", investors:"onebyone" },
//   { url:"darius",    title:"Convertible Note Agreement", investors:"onebyone" },
//   { url:"kissing",   title:"KISS(Sing) Agreement",       investors:"onebyone" },
  ];
return suitables;
};

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

// utility function to reset userproperties
function resetUserProperties() {
  var userP = PropertiesService.getUserProperties();
  userP.deleteAllProperties();
}

// ---------------------------------------------------------------------------------------------------------------- getEchoSignService()
// oAuth integration with EchoSign
// EchoSign uses OAuth 2
// so we grabbed https://github.com/googlesamples/apps-script-oauth2
// and we turned on the library.

function getnativeEchoSignService() {
// this uses a slightly different set of endpoints.

// first use the getEchoSignService to obtain OAuth tokens
// then use the getnativeEchoSignService to perform application calls.
}

function getEchoSignService() {
  // Create a new service with the given name. The name will be used when 
  // persisting the authorized token, so ensure it is unique within the 
  // scope of the property store.
  var toreturn = OAuth2.createService('echosign')

      // Set the endpoint URLs
      .setAuthorizationBaseUrl('https://secure.echosign.com/public/oauth')
      .setTokenUrl('https://secure.echosign.com/oauth/token')

      // Set the client ID and secret
      .setClientId('B9HLGY92L5Z4H5')
      .setClientSecret('ff4c883e539571273980245c41199b70')
  // from https://secure.echosign.com/account/application -- do this as a CUSTOMER not a PARTNER application.

      // Set the project key of the script using this library.
      .setProjectKey('M6VMONjB762l0FdR-z7tWO3YH5ITXFjPS')

      // Set the name of the callback function in the script referenced 
      // above that should be invoked to complete the OAuth flow.
      .setCallbackFunction('authCallback')

      // Set the property store where authorized tokens should be persisted.
      .setPropertyStore(PropertiesService.getUserProperties())

      // Set the scopes to request (space-separated for Google services).
      .setScope('agreement_read agreement_send agreement_write user_login library_read')


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

function postTransientDocument(fileBlob) {
  var api = getEchoSignService();
  var o = { headers: { "Access-Token": api.getAccessToken() } };
  o.method = "post";

  if (fileBlob == undefined) {
	fileBlob = UrlFetchApp.fetch("http://mengwong.com/tmp/potato%20form%205.pdf").getBlob();
  }

  o.payload = {
	"File-Name": "my Transient Document",
	"File":      fileBlob,
	"Mime-Type": "application/pdf",
};

  var response = UrlFetchApp.fetch(api.APIbaseUrl + '/transientDocuments', o);
  
//  SpreadsheetApp.getUi().alert(response.getContentText());

// {"transientDocumentId":"2AAABLblqZhCvz2Sc-yDHlZy9Zv_NweXjpM3_s6Id02cz8mJrFncvASsleSe_bv8Bc0CEnT0Eef6TjLLSD0ZYcT2LMYm0WWFSlYgJ05SVrfg0pQ01QnyiE4tHCpgeK0fp0bolv9-qrGirdkoppt7Q1pF0yas4eOS9IN-AHcXZ4uOy3fELHkSoLjt3GJsoFqKU21LzEpg_0wA*"}

  var r = JSON.parse(response.getContentText());

  PropertiesService.getScriptProperties().setProperty("transientDocumentId",r.transientDocumentId);

  Logger.log("transientDocumentId=%s",r.transientDocumentId);

  return r.transientDocumentId;
}

function showUserProperties() {
  Logger.log("userProperties: %s", JSON.stringify(PropertiesService.getUserProperties().getProperties()));
  
  Logger.log("scriptProperties: %s", JSON.stringify(PropertiesService.getScriptProperties().getProperties()));
}  


function uploadAgreement() {
  var acr = postAgreement_(
	{
//	  "documentURL": {
//		"name": "Potato Form Five",
//		"url": "http://mengwong.com/tmp/potato%20form%205.pdf",
//		mimeType: "application/pdf",
//	  }
	
	  transientDocumentId:   PropertiesService.getScriptProperties().getProperty("transientDocumentId")
,
	},
	[ { role:"SIGNER", email: "mengwong@jfdi.asia", },
	  { role:"SIGNER", email: "mengwong@gmail.com", },
	]
	);

  // {	"expiration": "date",
  // 	"agreementId": "string",
  // 	"embeddedCode": "string",
  // 	"url": "string" }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var cell = ss.getSheetByName("Deal Terms").getRange("F8");
  cell.setValue("=HYPERLINK(\""+acr.url+"\",\"EchoSign "+acr.agreementId+"\")")
}

function postAgreement_(fileInfos, recipients, agreementCreationInfo) {
  var api = getEchoSignService();

  if (agreementCreationInfo == undefined) {
	agreementCreationInfo = {
	  "documentCreationInfo": {
		"signatureType": "ESIGN",
		"recipients": recipients,
		"daysUntilSigningDeadline": "3",
		"ccs": [ "mengwong@legalese.io" ],
		"signatureFlow": "PARALLEL", // only available for paid accounts. we may need to check the user info and switch this to SENDER_SIGNATURE_NOT_REQUIRED if the user is in the free tier.
		"message": "This is a test document. Please sign and return.",
		"fileInfos": fileInfos,
		"name": "Test Agreement " + (new Date()),
	  },
	  "options": {
		"authoringRequested": false,
	  }
	};
  }

  var o = { };
//  o.oAuthServiceName = "echosign";
//  o.oAuthUseToken = "always";

  o.headers = { "Access-Token": api.getAccessToken(),
			  };
  o.contentType = 'application/json';

  o.method = "post";
  o.payload = JSON.stringify(agreementCreationInfo);

  Logger.log("about to dump %s", JSON.stringify(o));

  var response = UrlFetchApp.fetch(api.APIbaseUrl + '/agreements', o);

  if (response.getResponseCode() >= 400) {
	Logger.log("got response %s", response.getContentText());
	Logger.log("dying");
	return;
  }

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

  
