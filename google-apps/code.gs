/* TODO
 *
** import the termsheets from "How to invest in a JFDI Startup"
 *
**  move the "templates:" configurator from the README to the ActiveSheet. refactor the config processing logic so readrows and readconfig both
 *  use a standard set of functions. this is particularly important to allow the user to select the desired template without having to go over
 *  to the README sheet.
 *  
 *  how do we intuitively allow the end-user to select from among multiple deal terms spreadsheets?
 *  i think we choose the leftmost one, if SpreadsheetApp allows us to disambiguate indexes.
 * 
 *  how do we make it convenient for multiple deal terms to operate against the same set of parties?
 * 
**  reduce the security threat surface -- find a way to make this work with OnlyCurrentDoc.
 *  https://developers.google.com/apps-script/guides/services/authorization
 * 
 *  the risk is that a malicious commit on the legalese codebase will embed undesirable content in an xml template file
 *  which then runs with user permissions with access to all the user's docs. this is clearly undesirable.
 *  
 *  a functionally equivalent man-in-the-middle attack would intercept the UrlFetch() operation and return a malicious XML template file.
 * 
 *  lodging the XML templates inside the app itself is a seemingly attractive alternative, but it reduces to the same threat scenario because that data
 *  has to populate from somewhere in the first place.
 * 
 *  an alternative design sees the user sharing the spreadsheet with the Legalese Robot, which only has access to that one spreadsheet and no other files.
 *  the legalese robot would run, then share back a folder that contains the output. that limits exposure to user data.
 *  this sharing situation is clumsy -- why not just bring up a REST API that submits the active sheet's data as a sort of RPC to the robot?
 *  the robot would then issue a drive share in response.
 * 
 *  while we work on implementing that approach, we require that all committers with access to GitHub must have 2FA.
 * 
 *  ideally we would reduce the authorization scope of this script to only the current doc.
 *  but we need a way to share the resulting PDF with the user without access to everything in Drive!
*/


// ---------------------------------------------------------------------------------------------------- state
//
// a brief discussion regarding state.
// 
// A spreadsheet may contain one or more sheets with deal-terms and party particulars.
// 
// When the user launches a routine from the Legalese menu, the routine usually takes its configuration from the ActiveSheet.
// 
// But some routines are not launched from the Legalese menu. The form's submission callback writes to a sheet. How will it know which sheet to write to?
//
// Whenever we create a form, we shall record the ID of the then activeSheet into a UserProperty, "formActiveSheetId".
// Until the form is re-created, all submissions will feed that sheet.
//
// What happens if the user starts working on a different sheet? The user may expect that form submissions will magically follow their activity.
// 
// To correct this impression, we give the user some feedback whenever the activeSheet is not the formActiveSheet.
//
// The showSidebar shall check and complain.
//
// That same test is also triggered when a function is called: if the activesheet is different to the form submission sheet, we alert() a warning.
//
// 


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
  var sheet = spreadsheet.getActiveSheet();

  var entries = [
  { name:"Create Form", functionName:"setupForm_"},
  { name:"Generate Papers", functionName:"fillTemplates"},
  { name:"Send to EchoSign", functionName:"uploadAgreement"},
  { name:"faux MegaSign", functionName:"fauxMegaSign"},
  { name:"quicktest", functionName:"quicktest"},
  ];
  spreadsheet.addMenu("Legalese", entries);
  // when we release this as an add-on the menu-adding will change.

//  resetDocumentProperties("oauth2.echosign");

// next time we uncomment this we need to take legalese.uniq.x into account
// resetDocumentProperties("legalese.folder.id");
// resetDocumentProperties("legalese.rootfolder");

  PropertiesService.getDocumentProperties().deleteProperty("legalese.muteFormActiveSheetWarnings");

  showSidebar(sheet);
};

function getSheetById(ss, id) {
  var sheets = ss.getSheets();
  for (var i=0; i<sheets.length; i++) {
	Logger.log("does sheet " + i + " ( " + sheets[i].getSheetName() + " have id " + id + "?");
    if (sheets[i].getSheetId() == id) {
	  Logger.log("yes: " + sheets[i].getSheetId() + " = " + id + "?");
      return sheets[i];
    }
  }
  return;
}

function formActiveSheetChanged(sheet) {
  var formActiveSheetId = PropertiesService.getUserProperties().getProperty("legalese."+sheet.getParent().getId()+".formActiveSheetId");
  if (formActiveSheetId == undefined)              { return false }
  if (            sheet == undefined)              { return false }
  if (sheet.getParent().getFormUrl() == undefined) { return false }
  return (formActiveSheetId != sheet.getSheetId());
}

function muteFormActiveSheetWarnings(setter) {
  if (setter == undefined) { // getter
	var myprop = PropertiesService.getDocumentProperties().getProperty("legalese.muteFormActiveSheetWarnings");
	if (myprop != undefined) {
	  return JSON.parse(myprop);
	}
	else {
	  return false;
	}
  }
  else {
	PropertiesService.getDocumentProperties().setProperty("legalese.muteFormActiveSheetWarnings", JSON.stringify(setter));
  }
}

// todo: rethink all this to work with both controller and native sheet mode. now that we save the sheetid into the uniq'ed 

function templateActiveSheetChanged(sheet) {
  var templateActiveSheetId = PropertiesService.getDocumentProperties().getProperty("legalese.templateActiveSheetId");
  if (templateActiveSheetId == undefined)          { return false }
  if (                sheet == undefined)          { return false }
  Logger.log("templateActiveSheetChanged: comparing %s with %s, which is %s",
			 templateActiveSheetId, sheet.getSheetId(),
			 templateActiveSheetId == sheet.getSheetId()
			);
  return (templateActiveSheetId != sheet.getSheetId());
}

function muteTemplateActiveSheetWarnings(setter) {
  if (setter == undefined) { // getter
	var myprop = PropertiesService.getDocumentProperties().getProperty("legalese.muteTemplateActiveSheetWarnings");
	if (myprop != undefined) {
	  return JSON.parse(myprop);
	}
	else {
	  return false;
	}
  }
  else {
	PropertiesService.getDocumentProperties().setProperty("legalese.muteTemplateActiveSheetWarnings", JSON.stringify(setter));
  }
}

function alertIfActiveSheetChanged(sheet) {
  if (formActiveSheetChanged(sheet) &&
	 ! muteFormActiveSheetWarnings()) {

	var ui = SpreadsheetApp.getUi();
	var formActiveSheet = getSheetById(sheet.getParent(), PropertiesService.getUserProperties().getProperty("legalese."+sheet.getParent().getId()+".formActiveSheetId"));
	
	var response = ui.alert("Potential Form Mismatch",
							"Your form submits to " + formActiveSheet.getSheetName() + " but you are working on " + sheet.getSheetName() +".\nMute this warning?",
							ui.ButtonSet.YES_NO);
	
	if (response == ui.Button.YES) muteFormActiveSheetWarnings(true);
	else                           muteFormActiveSheetWarnings(false);
  }


  if (templateActiveSheetChanged(sheet) &&
	 ! muteTemplateActiveSheetWarnings()) {

	var ui = SpreadsheetApp.getUi();
	var templateActiveSheet = getSheetById(sheet.getParent(), PropertiesService.getDocumentProperties().getProperty("legalese.templateActiveSheetId"));
	
	var response = ui.alert("Potential Template Mismatch",
							"Your template was previously generated by sheet " + templateActiveSheet.getSheetName() + " but you are now working on " + sheet.getSheetName() +".\nMute this warning?",
							ui.ButtonSet.YES_NO);
	
	if (response == ui.Button.YES) muteTemplateActiveSheetWarnings(true);
	else                           muteTemplateActiveSheetWarnings(false);
  }
}

// ---------------------------------------------------------------------------------------------------------------- setupForm
/**
 * establish a form for parties to fill in their personal details
 *
 */
function setupForm_(sheet) {

  var sheetPassedIn = ! (sheet == undefined);
  if (! sheetPassedIn && SpreadsheetApp.getActiveSheet().getName() == "controller") {
	Logger.log("in controller mode, switching to setupOtherForms_()");
	setupOtherForms();
	return;
  }
  var sheet = sheet || SpreadsheetApp.getActiveSheet();

  var ss = sheet.getParent();
  var data_config = readRows_(sheet);
  var data   = data_config[0];
  var config = data_config[1];

  var cell = sheet.getRange("E4");
  var form = ss.getFormUrl();

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
	var form_title = config.form_title != undefined ? config.form_title.value : ss.getName();
	var form_description = config.form_description != undefined ? config.form_description.value : "Please fill in your details.";
	form = FormApp.create(form_title)
      .setDescription(form_description)
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
	  Logger.log("setting onFormSubmit trigger");
	}
  }

  // Create the form and add a multiple-choice question for each timeslot.
  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
  Logger.log("setting form destination to %s", ss.getId());
  PropertiesService.getUserProperties().setProperty("legalese."+ss.getId()+".formActiveSheetId", sheet.getSheetId().toString());
  Logger.log("setting formActiveSheetId to %s", sheet.getSheetId().toString());

  var origpartyfields = data._origpartyfields;
  Logger.log("origpartyfields = " + origpartyfields);
  for (var i in origpartyfields) {
	var partyfield = origpartyfields[i];
	Logger.log("partyfield "+i+" = " + partyfield.fieldname);
	if (partyfield.itemtype.match(/^list/)) {
	  var enums = partyfield.itemtype.split(' ');
	  enums.shift();

	  // TODO: get this out of the Data Validation https://developers.google.com/apps-script/reference/spreadsheet/data-validation
	  // instead of the Config section.
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

  if (config["form_extras"] != undefined) {
	for (var i in config.form_extras.values) {
	  var field = asvar_(config.form_extras.values[i]);
	  form.addListItem()
		.setTitle(config[field].dict["name"][0])
		.setRequired(config[field].dict["required"][0])
		.setChoiceValues(config[field].dict["choicevalues"])
		.setHelpText(config[field].dict["helptext"][0]);
	}
  }

  var form_url = form.getPublishedUrl();
  var short_url = form.shortenFormUrl(form_url);

  cell.setValue(short_url); SpreadsheetApp.flush();

  var legalese_root = legaleseRootFolder_();
  legalese_root.addFile(DriveApp.getFileById(form.getId()));
  legalese_root.addFile(DriveApp.getFileById(ss.getId()));
  Logger.log("added to legalese root folder");
}

function treeify_(root, arr) {
  if      (arr.length == 2) { root[arr[0]] = arr[1] }
  else if (arr.length == 1) { root[arr[0]] = null   }
  else if (arr.length == 0) { return }
  else                      { if (root[arr[0]] == undefined) root[arr[0]] = {};
							  treeify_(root[arr[0]], arr.slice(1)) }
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
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetId = PropertiesService.getUserProperties().getProperty("legalese."+ss.getId()+".formActiveSheetId");

  if (sheetId == undefined) { // uh-oh
	Logger.log("onFormSubmit: no formActiveSheetId property, so I don't know which sheet to record party data into. bailing.");
	return;
  }
  else {
	Logger.log("onFormSubmit: formActiveSheetId property = %s", sheetId);
  }

  var sheet = getSheetById(SpreadsheetApp.getActiveSpreadsheet(), sheetId);
  var data_config = readRows_(sheet);
  var data   = data_config[0];
  var config = data_config[1];

  // add a row and insert the investor fields
  Logger.log("onFormSubmit: inserting a row after " + (parseInt(data._last_party_row)+1));
  sheet.insertRowAfter(data._last_party_row+1); // might need to update the commitment sum range
  var newrow = sheet.getRange(data._last_party_row+2,1,1,sheet.getMaxColumns());
//  newrow.getCell(0,0).setValue("bar");

  // loop through the origpartyfields inserting the new data in the right place.
  for (names in e.namedValues) {
	Logger.log("onFormSubmit: e.namedValues = " + names + ": "+e.namedValues[names][0]);
  }

  var origpartyfields = data._origpartyfields;
  Logger.log("onFormSubmit: origpartyfields = " + origpartyfields);

  for (var i = 0; i < origpartyfields.length; i++) {
	var partyfield = origpartyfields[i];

	// fill in the default party role
	if (i == 0 && partyfield == undefined) {
	  partyfield = { fieldname: "_party_role", column: 1 };
	  e.namedValues["_party_role"] = [ config.default_party_role.value ];
	  Logger.log("setting default party row in column 1 to %s", config.default_party_role.value);
	}
	  
	// fill in any fields which are hidden and have a default value configured. maybe in future we should extend the default-filling to all blank submissions
	else if (e.namedValues[partyfield.fieldname] == undefined) {
	  Logger.log("did not receive form submission for %s", partyfield.fieldname);

	  if (partyfield["default"] != undefined) {
		Logger.log("filling with default value %s", partyfield["default"]);
		e.namedValues[partyfield.fieldname] = [ partyfield["default"] ];
	  }
	  else {
		continue;
	  }
	}

	Logger.log("onFormSubmit: partyfield "+i+" (" + partyfield.fieldname+") (column="+partyfield.column+") = " + e.namedValues[partyfield.fieldname][0]);

	var newcell = newrow.getCell(1,parseInt(partyfield.column));
	Logger.log("onFormSubmit: setting value of cell to " + e.namedValues[partyfield.fieldname]);
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
function readRows_(sheet) {
  Logger.log("readRows_: will use sheet " + sheet.getName());
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
  var parties = { _allparties:[], _unmailed:[], founder:[], existing_shareholder:[], company:[], investor:[] }; // types don't need to be defined here really
  // maybe we should do it this way and just synthesize the partygroups as needed, along with any other filters.
  var terms_row_offset;
  var config = {};
  var previous = [];

  Logger.log("readRows: starting.");

// get the formats for the B column -- else we won't know what currency the money fields are in.
  var term_formats = sheet.getRange(1,2,numRows).getNumberFormats();

  var es_num = 1; // for email ordering the EchoSign fields

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
    else if (row[0] == "PARTYFORM_DEFAULT") { section=row[0]; for (var ki in row) { if (ki<1||row[ki]==undefined||partyfieldorder[ki]==undefined||row[ki].length==0){continue}
																					Logger.log("learned default value for %s = %s", partyfieldorder[ki], row[ki]);
																					 origpartyfields[partyfieldorder[ki]]["default"] = row[ki];
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
        partyfields[ki] = asvar_(partyfields[ki]);
		Logger.log("readRows: recorded partyfield[%s]=%s", ki, partyfields[ki]);
      }
      continue;
	}
	else if (row[0] == "CONFIGURATION") { section = row[0]; continue }

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

	  if (singleparty.legalese_status.toLowerCase() == "ignore") { Logger.log("ignoring %s line", partytype);
																   continue }

      parties[partytype].push(singleparty);
	  parties._allparties.push(singleparty);

	  // set up the _unmailed attribute
	  if (singleparty.legalese_status == undefined || singleparty.legalese_status === "") {
		Logger.log("readRows: party %s hasn't been mailed yet. it will have es_num %s", singleparty.name, es_num);
		singleparty._to_email = email_to_cc_(singleparty.email)[0]; // and the subsequent addresses are in an array [1]
		singleparty._unmailed = true;
		singleparty._es_num = es_num++;
		// TODO: figure out how to do the es_num in a situation where the xml template may omit a character class.
		parties._unmailed.push(singleparty);
	  }
	  else if (singleparty.legalese_status.toLowerCase().match(/^(done|ignore|skip|mailed|cc)/i)) {
		Logger.log("readRows: founder %s has status %s, so leaving out from parties._unmailed", singleparty.name, singleparty.legalese_status);
	  }
	  else {
		Logger.log("readRows: founder %s has status %s; not sure what that means, but leaving out from parties._unmailed", singleparty.name, singleparty.legalese_status);
	  }
    }
	else if (section == "CONFIGURATION") {

	  // each config row produces multiple representations:
	  // config.columna.values is an array of values -- if columna repeats, then values from last line only
	  // config.columna.dict is a dictionary of b: [c,d,e] across multiple lines
	  
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

	  // build value -- config.a.value = b
	  config[columna].value = descended[1];

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
  terms._origpartyfields = origpartyfields;
  terms._partyfields = partyfields;
  terms.parties = parties;
  Logger.log("readRows: terms.parties = %s", terms.parties);
  Logger.log("readRows: config = %s\n" + JSON.stringify(config,null,"  "));
  return [terms, config];
}

// ---------------------------------------------------------------------------------------------------------------- getPartyCells_
function getPartyCells_(sheet, readrows, party) {
  Logger.log("looking to return a dict of partyfieldname to cell, for party %s", party.name);
  Logger.log("party %s comes from spreadsheet row %s", party.name, party._spreadsheet_row);
  Logger.log("the fieldname map looks like this: %s", readrows._partyfields);
  Logger.log("so the cell that matters for legalese_status should be row %s, col %s", party._spreadsheet_row, readrows._partyfields.indexOf("legalese_status")+1);
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

// ---------------------------------------------------------------------------------------------------------------- asvar_
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
      toreturn = (string * 100).toFixed(2);
    }
    else if (format.match(/yyyy/)) {
    // Thu Dec 18 09:03:28 PST 2014 INFO: expanding term Fri Dec 19 2014 00:00:00 GMT+0800 (HKT) with format yyyy"-"mm"-"dd
    // Thu Dec 18 09:03:28 PST 2014 INFO: expanding term Thu Jan 15 2015 00:00:00 GMT+0800 (HKT) with format yyyy"-"mm"-"dd
      toreturn = string.toString().substr(0,15).replace(/ 0/, " ");  // Jan 01 2015 => Jan 1 2015
    } else { toreturn = string }
  }
  else { toreturn = string }
//  Logger.log("formatify_("+format+","+string+") = "+toreturn);
  return toreturn;
}

// ---------------------------------------------------------------------------------------------------------------- clauseroot / clausetext2num
// this is a hints db which hasn't been implemented yet. For InDesign we indicate cross-references in the XML already.
// but for the non-InDesign version we have to then number by hand.
// 
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


function otherSheets() {
  var activeRange = SpreadsheetApp.getActiveRange(); // user-selected range
  var rangeValues = activeRange.getValues();
  var toreturn = [];
  for (var i = 0; i < rangeValues.length; i++) {
	var myRow = activeRange.getSheet().getRange(activeRange.getRow()+i, 1, 1, 10);
	Logger.log("you are interested in row " + myRow.getValues()[0]);
	var ss;
	try { ss = SpreadsheetApp.openById(myRow.getValues()[0][0]) } catch (e) {
	  Logger.log("couldn't open indicated spreadsheet ... probably on wrong row. %s", e);
	  SpreadsheetApp.getUi().alert("unable to open a separate spreadsheet -- is your selection on the correct row?");
	  return;
	}
	var sheet = getSheetById(ss, myRow.getValues()[0][1])
	Logger.log("smoochy says otherSheets: sheet %s is on row %s", i.toString(), myRow.getRowIndex().toString());
	myRow.getCell(1,3).setValue("=HYPERLINK(\""
								+sheet.getParent().getUrl()
								+"#gid="
								+sheet.getSheetId()
								+"\",\""
								+sheet.getParent().getName()
								+"\")");
	toreturn.push(sheet);
  }
  return toreturn;
}

// ---------------------------------------------------------------------------------------------------------------- quicktest
function quicktest() {
  var sheets = otherSheets();
}

function uniqueKey(sheet) {
  var ss = sheet.getParent();
  return ss.getId() + "/" + sheet.getSheetId();
}

// ---------------------------------------------------------------------------------------------------------------- quicktest
function setupOtherForms() {
  var sheets = otherSheets();
  for (var i = 0; i < sheets.length; i++) {
	var sheet = sheets[i];
	setupForm_(sheet);
	var myRow = SpreadsheetApp.getActiveRange().getSheet().getRange(SpreadsheetApp.getActiveRange().getRow()+i, 1, 1, 10);
	Logger.log("smoochy says setupOtherForms: sheet %s is on row %s", i.toString(), myRow.getRowIndex().toString());
	myRow.getCell(1,7).setValue('=IMPORTRANGE(A'
								+myRow.getRowIndex()
								+',"Founder Agreement!e4")');
  }
}

// ---------------------------------------------------------------------------------------------------------------- quicktest
function fillOtherTemplates() {
  var sheets = otherSheets();
  for (var i = 0; i < sheets.length; i++) {
	var sheet = sheets[i];
	Logger.log("will generate template for " + sheet.getName());
	fillTemplates(sheet);

	var uniq = uniqueKey(sheet);

	var myRow = SpreadsheetApp.getActiveSheet().getRange(SpreadsheetApp.getActiveRange().getRow()+i, 1, 1, 10);

	myRow.getCell(1,4).setValue("=HYPERLINK(\"https://drive.google.com/drive/u/0/#folders/"
								+JSON.parse(PropertiesService.getDocumentProperties().getProperty("legalese."+uniq+".folder.id"))
								+"\",\""
								+JSON.parse(PropertiesService.getDocumentProperties().getProperty("legalese."+uniq+".folder.name"))
								+"\")");

	// this loses the hyperlink
	// myRow.getCell(1,4).setValue('=IMPORTRANGE(A' +myRow.getRowIndex() +',"Founder Agreement!e6")');

	myRow.getCell(1,5).setValue("unsent");
  }
}

// ---------------------------------------------------------------------------------------------------------------- quicktest
function uploadOtherAgreements() {
  var sheets = otherSheets();
  for (var i = 0; i < sheets.length; i++) {
	var sheet = sheets[i];
	var myRow = SpreadsheetApp.getActiveSheet().getRange(SpreadsheetApp.getActiveRange().getRow()+i, 1, 1, 10);
	var result = uploadAgreement(sheet);
	if (result == "sent") {
	  myRow.getCell(1,5).setValue("sent at "+ Utilities.formatDate(new Date(), sheet.getParent().getSpreadsheetTimeZone(), "yyyyMMdd-HHmmss"));
	}
	else {
	  myRow.getCell(1,5).setValue(result);
	}
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

// templates don't always have to live at an HTTP url.
// you can also create an HTML file in the code editor and just give the filename directly.
// the url will be something like termsheet_xml.html instead of termsheet.xml.

  { name:"employment_agreement_xml", url:"http://www.legalese.io/templates/jfdi.asia/employment-agreement.xml",       title:"Employment Agreement" },
  { name:"termsheet_xml",         url:"http://www.legalese.io/templates/jfdi.asia/termsheet.xml",       title:"Seed Term Sheet" },
  { name:"preemptive_notice_xml", url:"http://www.legalese.io/templates/jfdi.asia/preemptive_notice.xml",       title:"Pre-Emptive Notice to Shareholders" },
  { name:"loan_waiver_xml",		  url:"http://www.legalese.io/templates/jfdi.asia/convertible_loan_waiver.xml", title:"Waiver of Convertible Loan" },
  { name:"simplified_note_xml",   url:"http://www.legalese.io/templates/jfdi.asia/simplified_note.xml",         title:"Simplified Convertible Loan Agreement" },
  { name:"founder_agreement_xml", url:"http://www.legalese.io/templates/jfdi.asia/founderagreement.xml",        title:"JFDI Accelerate Founder Agreement" },
  { name:"dora_xml",			  url:"http://www.legalese.io/templates/jfdi.asia/dora-signatures.xml",         title:"DORA" },

  { name:"inc_signature",		  url:"http://www.legalese.io/templates/jfdi.asia/inc_signature.xml",           title:"signature component" },
  { name:"inc_party",		 	  url:"http://www.legalese.io/templates/jfdi.asia/inc_party.xml",               title:"party component" },

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
  return array1.filter(function(n) { return array2.indexOf(n.name) != -1 || array2.indexOf(n.name.replace(/_xml/,"")) != -1 });
}

// obtainTemplate
// initially we just assume the template is available as one of the project's HTML files.
// in future we may pull a generic HTML template from somewhere else.
function obtainTemplate_(url) {
  Logger.log("obtainTemplate_(%s) called", url);

  // we're actually running within a single script invocation so maybe we should find a more intelligent way to cache within a single session.
  // otherwise this risks not picking up changes

  if (url.match(/^http/)) {
	var cache = CacheService.getDocumentCache();
	var cached = cache.get(url);
	if (cached != null) {
	  return HtmlService.createTemplate(cached);
	}
	else {
	  var result = UrlFetchApp.fetch(url);
	  var contents = result.getContentText();
	  // the cache service can only store keys of up to 250 characters and content of up to 100k, so over that, we don't cache.
	  if (contents.length < 100000 && url.length < 250) {
		cache.put(url, contents, 60);
	  }
	  Logger.log("obtained template %s, length %s bytes", url, contents.length);
	  return HtmlService.createTemplate(contents);
	}
  }
  else return HtmlService.createTemplateFromFile(url);
}

// ---------------------------------------------------------------------------------------------------------------- fillTemplates
function fillTemplates(sheet) {

  var sheetPassedIn = ! (sheet == undefined);
  if (! sheetPassedIn && SpreadsheetApp.getActiveSheet().getName() == "controller") {
	Logger.log("in controller mode, switching to fillOtherTemplates()");
	fillOtherTemplates();
	return;
  }
  sheet = sheet || SpreadsheetApp.getActiveSheet();
  var data_config = readRows_(sheet);
  var templatedata   = data_config[0];
  var config         = data_config[1];
  templatedata.clauses = {};
  templatedata._config = config;

  if (! sheetPassedIn) { alertIfActiveSheetChanged(sheet); }

  var uniq = uniqueKey(sheet);

  var folder = createFolder_(sheet); var readme = createReadme_(folder, config, sheet);
  PropertiesService.getDocumentProperties().setProperty("legalese."+uniq+".folder.id", JSON.stringify(folder.getId()));
  PropertiesService.getDocumentProperties().setProperty("legalese."+uniq+".folder.name", JSON.stringify(folder.getName()));
  PropertiesService.getDocumentProperties().setProperty("legalese.templateActiveSheetId", sheet.getSheetId());
  Logger.log("fillTemplates: property set legalese.%s.folder.id = %s", uniq, folder.getId());
  Logger.log("fillTemplates: property set legalese.%s.templateActiveSheetId = %s", uniq, sheet.getSheetId());

  var cell = sheet.getRange("E6");

  // let's insert the Drive version not the Docs version of the folder url
  cell.setValue("=HYPERLINK(\"https://drive.google.com/drive/u/0/#folders/"+folder.getId()+"\",\""+folder.getName()+"\")");
  Logger.log("I have set the value to =HYPERLINK(\"https://drive.google.com/drive/u/0/#folders/"+folder.getId()+"\",\""+folder.getName()+"\")");

  var availables = availableTemplates_();
  var desireds = desiredTemplates_(config);
  var suitables = intersect_(availables, desireds);

  Logger.log("resolved suitables = %s", suitables.map(function(e){return e.url}).join(", "));

  Logger.log("templatedata.parties = %s", JSON.stringify(templatedata.parties));

  templatedata.company = templatedata.parties.company[0];
  Logger.log("templatedata.company = %s", templatedata.company);
  templatedata.founders = templatedata.parties.founder;

  for (var i in suitables) {
    var sourceTemplate = suitables[i];
    var url = sourceTemplate.url;
    var newTemplate = obtainTemplate_(url);
    newTemplate.data = templatedata;
    newTemplate.data._explosion = newTemplate.data._explosion || {};
	var sans_xml = sourceTemplate.name.replace(/_xml|xml_/,"");

	// TODO: respect the "all in one doc" vs "one per doc" for all categories not just investors

    var investors = templatedata.parties.investor;
	var explosion = "all in one doc";
	try { explosion = config.templates.tree[sans_xml]["Investor"] } catch (e) { Logger.log("ERROR: explosion exploded: %s", e); }
	if (explosion == "all in one doc") {
	  Logger.log("doing investors all in one doc ... " + sourceTemplate.url);
	  newTemplate.data._explosion.investor = false;
	  fillTemplate_(newTemplate, sourceTemplate, sourceTemplate.title, folder); // todo: make the title configured in the spreadsheet itself, and get rid of the hardcoded title from the availabletemplates code below.
	  readme.getBody().appendParagraph("created " + sourceTemplate.title);
	}
	else {
	  Logger.log("doing investors one per doc ... " + sourceTemplate.url);
	  newTemplate.data._explosion.investor = true;
      for (var j in investors) {
		// we step through the multiple data.parties.{founder,investor,company}.* arrays.
		// we set the singular as we step through.
		newTemplate.data.investor = investors[j];
		var mytitle = sourceTemplate.title + " for " + templatedata.investor.name;
		Logger.log("starting " + mytitle);
		fillTemplate_(newTemplate, sourceTemplate, mytitle, folder);
		readme.getBody().appendParagraph("created " + mytitle);
	  }
    }
	Logger.log("finished suitable %s", url);
  }
  Logger.log("that's all folks!");
};

// ---------------------------------------------------------------------------------------------------------------- fillTemplate_
// fill a single template -- inner-loop function for fillTemplates() above.
// 
// it's possible that a template references another template.
// the Google Docs HTMLTemplate engine is pretty basic and has no concept
// of modular components.
//
// so, we define an include() function.

function include(name, data, _include) {
  Logger.log("running include for %s", name);
  var filtered = availableTemplates_().filter(function(t){return t.name == name});
  if (filtered.length == 1) {
	var template = filtered[0];
	var childTemplate = obtainTemplate_(template.url);
	childTemplate.data = data;
	childTemplate.data._include = _include;
	var filledHTML = childTemplate.evaluate().setSandboxMode(HtmlService.SandboxMode.IFRAME).getContent();
	return filledHTML;
  }
  Logger.log("unable to find template named %s", name);
  return;
}

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
  var legalese_root;

  var legalese_rootfolder_id = PropertiesService.getDocumentProperties().getProperty("legalese.rootfolder");
  if (! legalese_rootfolder_id == undefined) {
	legalese_root = DriveApp.getFolderById(JSON.parse(legalese_rootfolder_id));
  }
  else {
	var legaleses = DriveApp.getFoldersByName("Legalese Root");
	Logger.log("legaleses = " + legaleses);
	if (legaleses.hasNext()) {
	  Logger.log("legaleses is defined");
	  legalese_root = legaleses.next();
	  Logger.log("legalese_root = " + legalese_root);
	} else {
	  legalese_root = DriveApp.createFolder("Legalese Root");
	}
	PropertiesService.getDocumentProperties().setProperty("legalese.rootfolder", JSON.stringify(legalese_root.getId));
  }
  return legalese_root;
}

// ---------------------------------------------------------------------------------------------------------------- createFolder_
function createFolder_(sheet) {
  var legalese_root = legaleseRootFolder_();
  Logger.log("attempting createfolder");
  var folder = legalese_root.createFolder(sheet.getParent().getName() + " "
										  + sheet.getSheetName() + " "
										  + Utilities.formatDate(new Date(), sheet.getParent().getSpreadsheetTimeZone(), "yyyyMMdd-HHmmss"));
  Logger.log("createfolder returned " + folder);

  legalese_root.addFile(DriveApp.getFileById(sheet.getParent().getId()));

  return folder;
};

// ---------------------------------------------------------------------------------------------------------------- createReadme_
function createReadme_(folder, config, sheet) { // under the parent folder
  var spreadsheet = sheet.getParent();
  var doc = DocumentApp.create("README for " + spreadsheet.getName());

  folder.addFile(DriveApp.getFileById(doc.getId()));
  doc.getBody().appendParagraph("this was created by Legalese.");

  var para = doc.getBody().appendParagraph("The origin spreadsheet is ");
  var text = para.appendText(spreadsheet.getName() + ", " + sheet.getName());
  text.setLinkUrl(spreadsheet.getUrl() + "#gid=" + sheet.getSheetId());
  Logger.log("run started");
  var uniq = uniqueKey(sheet);
  PropertiesService.getDocumentProperties().setProperty("legalese."+uniq+".readme.id", JSON.stringify(doc.getId()));
  return doc;
}

function getReadme_(sheet) {
  var uniq = uniqueKey(sheet);
  var id = PropertiesService.getDocumentProperties().getProperty("legalese."+uniq+".readme.id");
  if (id != undefined) {
	return DocumentApp.openById(JSON.parse(id));
  }
  return;
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

// ---------------------------------------------------------------------------------------------------------------- resetDocumentProperties
// utility function to reset userproperties
function resetDocumentProperties(which) {
  var props = PropertiesService.getDocumentProperties();
  if (which == "all") props.deleteAllProperties();
  else props.deleteProperty(which);
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
      .setPropertyStore(PropertiesService.getDocumentProperties())

      // Set the scopes to request (space-separated for Google services).
      .setScope('agreement_read agreement_send agreement_write user_login library_read library_write');

  var ssid = SpreadsheetApp.getActiveSpreadsheet().getId();
  var ssname = SpreadsheetApp.getActiveSpreadsheet().getName();

  var esApps = {
	"2014B DD3 Disclaimer" : { 
	  clientId:"BGT7YYB6QWXA7F", 
	  clientSecret:"bfe3d07fa87540f1adfd67eaea6e2a7f", 
	  projectKey:"MPAgnivL4fa0Qi0viwHQwrMUQWaHMB8in" },
	"Waiver of Convertible Loan" : { 
	  clientId:"B8WRFA45X5727E", 
	  clientSecret:"0ef004d92582af21ceda0ee94e8ba5c2", 
	  projectKey:"M8Z8igDQBcgVeVy1AdAskyHYH5ITXFjPS" },
	"1CUPlbK0yVw_7EstVEhKu7wbD_ul_nY2LanSF2JYprx8" : { 
	  clientId:"B7ANAKXAX94V6P", 
	  clientSecret:"417e13ac801250d2146892eb0266d16e", 
	  projectKey:"MaupJZ_cPWIZT_FzZJu5q9XYH5ITXFjPS" },
  "default" : { 
	clientId:"B9HLGY92L5Z4H5", 
	clientSecret:"ff4c883e539571273980245c41199b70", 
	projectKey:"M6VMONjB762l0FdR-z7tWO3YH5ITXFjPS" },
  };

  if (esApps[ssid] != undefined) { ssname = ssid }
  if (esApps[ssname] == undefined) { ssname = "default" }

  Logger.log("ssname has become %s", ssname);

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
function showSidebar(sheet) {
  var echosignService = getEchoSignService();
  echosignService.reset();
  // blow away the previous oauth, because there's a problem with using the refresh token after the access token expires after the first hour.

  if (echosignService.hasAccess()) {
	Logger.log("showSidebar: we have access. doing nothing.");
  } else {
	Logger.log("showSidebar: we lack access. showing sidebar");
    var authorizationUrl = echosignService.getAuthorizationUrl();

	var myTemplate = '<p><a href="<?= authorizationUrl ?>" target="_blank">Authorize EchoSign</a>. ' +
      'Close this sidebar when authorization completes.</p>';

	if (templateActiveSheetChanged(sheet)) {
	  var formActiveSheet = PropertiesService.getDocumentProperties().getProperty("legalese."+sheet.getParent().getId()+".formActiveSheetId");
	  myTemplate = myTemplate + '<h2>Potential Form Mismatch</h2><p>Active sheet may have changed. If you\'re working with this sheet, you might want to recreate the form so that form submissions go here instead.</p>';
	}

    var template = HtmlService.createTemplate(myTemplate);
    template.authorizationUrl = authorizationUrl;
    var page = template.evaluate();
	page
      .setSandboxMode(HtmlService.SandboxMode.IFRAME)
      .setTitle('OAuth to EchoSign')
      .setWidth(300);
	SpreadsheetApp.getUi() // Or DocumentApp or FormApp.
      .showSidebar(page);

  }
}

// ---------------------------------------------------------------------------------------------------------------- authCallback
function authCallback(request) {
  var echosignService = getEchoSignService();
  var isAuthorized = echosignService.handleCallback(request);
  if (isAuthorized) {
    return HtmlService.createHtmlOutput('Success! You can close this tab.\nBTW the token property is ' +  PropertiesService.getDocumentProperties().getProperty("oauth2.echosign"));
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
function uploadPDFsToEchoSign(sheet) {
  var api = getEchoSignService();
  var o = { headers: { "Access-Token": api.getAccessToken() } };
  o.method = "post";

  var uniq = uniqueKey(sheet);

  var folderId   = JSON.parse(PropertiesService.getDocumentProperties().getProperty("legalese."+uniq+".folder.id"));
  var folderName = JSON.parse(PropertiesService.getDocumentProperties().getProperty("legalese."+uniq+".folder.name"));
  Logger.log("uploadPDFsToEchoSign: for spreadsheet %s, folder.id = %s", uniq, folderId);
  if (folderId == undefined) {
	SpreadsheetApp.getUi().alert("Not sure which folder contains PDFs.\nPlease regenerate documents by clicking Legalese / Generate Docs");
	return;
  }
  var folder = DriveApp.getFolderById(folderId);
  var pdfs = allPDFs(folder);
  var toreturn = [];

  if (pdfs.length == 0) {
	SpreadsheetApp.getUi().alert("Couldn't find a PDF to upload. You may need to poke InDesign.");
	return toreturn;
  }	

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

// ---------------------------------------------------------------------------------------------------------------- showDocumentProperties
function showDocumentProperties() {
  Logger.log("userProperties: %s", JSON.stringify(PropertiesService.getDocumentProperties().getProperties()));
  Logger.log("scriptProperties: %s", JSON.stringify(PropertiesService.getScriptProperties().getProperties()));
}  

function email_to_cc_(email) {
  var to = null;
  var emails = email.split(/\s*[\n\r,]\s*/).filter(function(e){return e.length > 0});
  if (emails.length > 0) {
	to = [emails.shift()];
  }
  return [to, emails];
}

// ---------------------------------------------------------------------------------------------------------------- fauxMegaUpload
// upload a document to the template library
function fauxMegaUpload() {
  // we do this using the web UI
}

// ---------------------------------------------------------------------------------------------------------------- fauxMegaSign
// send a particular document from the template library for faux megasign
function fauxMegaSign(sheet) {
  var sheetPassedIn = ! (sheet == undefined);
  sheet = sheet || SpreadsheetApp.getActiveSheet();
  var data_config = readRows_(sheet);
  var readrows    = data_config[0];
  var config      = data_config[1];

  alertIfActiveSheetChanged(sheet);

  var parties = readrows.parties;
  var to_list = [];
  var cc_list = parties._allparties.filter(function(party){return party.legalese_status.toLowerCase()=="cc"});
  var cc2_list = [];
  var commit_updates_to = [];
  var commit_updates_cc = [];

  // is the desired document in the library?
  var libTemplateName = config.echosign.tree.libTemplateName != undefined ? config.echosign.tree.libTemplateName : undefined;

  if (libTemplateName == undefined) {
	Logger.log("libTemplateName not defined in README. not uploading agreement.");
	return;
  }

  var now = Utilities.formatDate(new Date(), sheet.getParent().getSpreadsheetTimeZone(), "yyyyMMdd-HHmmss");
  
  for (var p in parties._unmailed) {
	var party = parties._unmailed[p];
	// if multi-address, then first address is To: and subsequent addresses are CC
	var to_cc = email_to_cc_(party.email);
	if (to_cc[0] != undefined && to_cc[0].length > 0) {
	  party._email_to = to_cc[0];
	  to_list.push(party);
	  party._commit_update_to = getPartyCells_(sheet, readrows, party);
	}
	if (to_cc[1].length > 0) {
	  cc2_list = cc2_list.concat(to_cc[1]);
	}
  }
  Logger.log("we shall be emailing to %s", to_list.join(", "));

  if (to_list.length == 0) {
	SpreadsheetApp.getUi().alert("There doesn't seem to be anybody for us to mail this to! Check the Legalese Status column.");
	return;
  }

  // TODO: who shall we cc to? everybody whose legalese status == "cc".
  for (var p in cc_list) {
	var party = cc_list[p];
	party._commit_update_cc = getPartyCells_(sheet, readrows, party);
  }
  cc_list = cc_list.map(function(party){return party.email});
  cc_list = cc_list.concat(cc2_list);

  Logger.log("To: %s", to_list.join(", "));
  Logger.log("CC: %s", cc_list.join(", "));

  var ss = sheet.getParent();

  for (var p in to_list) {
	var party = to_list[p];
	var emailInfo = [{email:party._email_to, role:"SIGNER"}];
	
	var acr = postAgreement_(	{ "libraryDocumentName": libTemplateName },
								emailInfo,
								config.echosign.tree.message,
								config.echosign.tree.title,
								cc_list,
								config,
								null
							);
	
	party._commit_update_to.legalese_status.setValue("mailed echosign " + now);
	Logger.log("fauxMegaSign: well, that seems to have worked!");
  }
  Logger.log("fauxMegaSign: that's all, folks!");
}

// ---------------------------------------------------------------------------------------------------------------- uploadAgreement
// send PDFs to echosign.
// if the PDFs don't exist, send them to InDesign for creation and wait.
// for extra credit, define a usercallback and associate it with a StateToken so InDesign can proactively trigger a pickup.
// for now, just looking for the PDFs in the folder seems to be good enough.
function uploadAgreement(sheet) {
  // TODO: we need to confirm that the docs generated match the current sheet.

  var echosignService = getEchoSignService();
  // blow away the previous oauth, because there's a problem with using the refresh token after the access token expires after the first hour.
  if (!echosignService.hasAccess()) {
	SpreadsheetApp.getUi().alert("we don't have echosign access.");
	return "echosign fail";
  }
  else {
	Logger.log("uploadAgreement: we have echosignService hasAccess = true");
  }


  var sheetPassedIn = ! (sheet == undefined);

  if (! sheetPassedIn && SpreadsheetApp.getActiveSheet().getName() == "controller") {
	Logger.log("in controller mode, switching to uploadOtherAgreements()");
	uploadOtherAgreements();
	return;
  }

  sheet = sheet || SpreadsheetApp.getActiveSheet();
  var ss = sheet.getParent();

  var data_config = readRows_(sheet);
  var readrows    = data_config[0];
  var config      = data_config[1];

  alertIfActiveSheetChanged(sheet);

  var parties = readrows.parties;
  var transientDocumentIds = uploadPDFsToEchoSign(sheet);
  var emailInfo = [];
  var cc_list = parties._allparties.filter(function(party){return party.legalese_status.toLowerCase()=="cc"});
  var cc2_list = [];
  var commit_updates_to = [];
  var commit_updates_cc = [];
  var readmeDoc = getReadme_(sheet);

  if (transientDocumentIds == undefined || transientDocumentIds.length == 0) {
	Logger.log("nothing uploaded to EchoSign. not uploading agreement.");
	if (readmeDoc != undefined) readmeDoc.getBody().appendParagraph("nothing uploaded to EchoSign. not uploading agreement.");
	return "no docs found!";
  }

  // does the spreadsheet have a "Legalese Status" field?
  // if not, create a column in the spreadsheet, to the right of the rightmost filled column.

  var now = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), "yyyyMMdd-HHmmss");
  
  // update the party's Legalese Status cell to indicate we've sent the mail.
  
  for (var p in parties._unmailed) {
	var party = parties._unmailed[p];
	// if multi-address, then first address is To: and subsequent addresses are CC
	var to_cc = email_to_cc_(party.email);
	if (to_cc[0] != undefined) {
	  emailInfo.push({email:to_cc[0], role:"SIGNER"});
	  commit_updates_to.push(getPartyCells_(sheet, readrows, party));
	}
	if (to_cc[1].length > 0) {
	  cc2_list = cc2_list.concat(to_cc[1]);
	}
  }
  Logger.log("we shall be emailing to %s", emailInfo);

  if (emailInfo.length == 0) {
	SpreadsheetApp.getUi().alert("There doesn't seem to be anybody for us to mail this to! Check the Legalese Status column.");
	return "no recipients!";
  }

  // TODO: who shall we cc to? everybody whose legalese status == "cc".
  for (var p in cc_list) {
	var party = cc_list[p];
	commit_updates_cc.push(getPartyCells_(sheet, readrows, party));
  }
  cc_list = cc_list.map(function(party){return party.email});
  cc_list = cc_list.concat(cc2_list);

  Logger.log("To: %s", emailInfo.map(function(party){return party.email}));
  Logger.log("CC: %s", cc_list);

  readmeDoc.appendHorizontalRule();
  readmeDoc.appendParagraph("To: " + emailInfo.map(function(party){return party.email}).join(", "));
  readmeDoc.appendParagraph("CC: " + cc_list.join(", "));

  for (var i in transientDocumentIds) {
	var transientDocumentId = transientDocumentIds[i];
	Logger.log("turning transientDocument %s into an agreement", transientDocumentId);

	for (var cu in commit_updates_to) { commit_updates_to[cu].legalese_status.setValue("mailed echosign " + now) }
	for (var cu in commit_updates_cc) { commit_updates_cc[cu].legalese_status.setValue("CC'ed echosign " + now) }

	var acr = postAgreement_(	{ "transientDocumentId": transientDocumentId },
								emailInfo,
								config.echosign.tree.message,
								config.echosign.tree.title,
								cc_list,
								config,
								readmeDoc
							);

	Logger.log("uploadAgreement: well, that seems to have worked!");

  }

  Logger.log("uploadAgreement: that's all, folks!");
  return "sent";
}

function postAgreement_(fileInfos, recipients, message, name, cc_list, config, readmeDoc, agreementCreationInfo) {
  var api = getEchoSignService();

  if (agreementCreationInfo == undefined) {
	agreementCreationInfo = {
	  "documentCreationInfo": {
		"signatureType": "ESIGN",
		"recipients": recipients,
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

	if (config.expire_after != undefined && config.expire_after.values[0] > 0) {
	  agreementCreationInfo.daysUntilSigningDeadline = config.expire_after.values[0];
	}
  }

  if (readmeDoc != undefined) readmeDoc.appendParagraph("agreementCreationInfo = " + JSON.stringify(agreementCreationInfo));

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

  
function mylogger(input) {
  Logger.log(input);
}
// TODO:
// data.parties._investor_plural
// how many parties are there in all of the investors? if there's only one investor and it's a natural person then the answer is 1.
// otherwise the answer is probably plural.
// used by the convertible_loan_waiver.

