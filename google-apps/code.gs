/* TODO
 *
 * todo -- do the right thing with emailing exploded people. set esnum to contiguous 1,2,3 in each exploded file.
 * todo -- write to the Readme the list of To: and CC: for when the user is submitting to EchoSign manually.
 *
 * we need a high level way to say "generate workflow W containing agreements X1, X2, X3 for company Y".
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
// A spreadsheet may contain one or more sheets with deal-terms and entity particulars.
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

  var addOnMenu = SpreadsheetApp.getUi().createAddonMenu()
	.addItem("Create Form", "setupForm_")
	.addItem("Generate PDFs", "fillTemplates");

  var echosignService = getEchoSignService_();
  if (echosignService != null) { 
	  addOnMenu.addItem("Send to EchoSign", "uploadAgreement");
  }

  addOnMenu.addToUi();

  // when we release this as an add-on the menu-adding will change.

//  resetDocumentProperties_("oauth2.echosign");

// next time we uncomment this we need to take legalese.uniq.x into account
// resetDocumentProperties_("legalese.folder.id");
// resetDocumentProperties_("legalese.rootfolder");

  PropertiesService.getDocumentProperties().deleteProperty("legalese.muteFormActiveSheetWarnings");

  // if we're on the Natural Language UI, reset C2's data validation to the appropriate range.
  if (sheet.getName() == "UI") {
	var sectionRange = sectionRangeNamed(sheet,"Entity Groups");
	var myRange = sheet.getRange(sectionRange[0], 2, sectionRange[1]-sectionRange[0]+1, 1);
	Logger.log("resetting C2 datavalidation range to " + myRange.getA1Notation());
	setDataValidation(sheet, "C2", myRange.getA1Notation());
  }
  
  showSidebar(sheet);
};

function getSheetById_(ss, id) {
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

function formActiveSheetChanged_(sheet) {
  var formActiveSheetId = PropertiesService.getUserProperties().getProperty("legalese."+sheet.getParent().getId()+".formActiveSheetId");
  if (formActiveSheetId == undefined)              { return false }
  if (            sheet == undefined)              { return false }
  if (sheet.getParent().getFormUrl() == undefined) { return false }
  return (formActiveSheetId != sheet.getSheetId());
}

function muteFormActiveSheetWarnings_(setter) {
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

function templateActiveSheetChanged_(sheet) {
  var templateActiveSheetId = PropertiesService.getDocumentProperties().getProperty("legalese.templateActiveSheetId");
  if (templateActiveSheetId == undefined)          { return false }
  if (                sheet == undefined)          { return false }
  Logger.log("templateActiveSheetChanged: comparing %s with %s, which is %s",
			 templateActiveSheetId, sheet.getSheetId(),
			 templateActiveSheetId == sheet.getSheetId()
			);
  return (templateActiveSheetId != sheet.getSheetId());
}

function muteTemplateActiveSheetWarnings_(setter) {
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

function alertIfActiveSheetChanged_(sheet) {
  if (formActiveSheetChanged_(sheet) &&
	 ! muteFormActiveSheetWarnings_()) {

	var ui = SpreadsheetApp.getUi();
	var formActiveSheet = getSheetById_(sheet.getParent(), PropertiesService.getUserProperties().getProperty("legalese."+sheet.getParent().getId()+".formActiveSheetId"));
	
	var response = ui.alert("Potential Form Mismatch",
							"Your form submits to " + formActiveSheet.getSheetName() + " but you are working on " + sheet.getSheetName() +".\nMute this warning?",
							ui.ButtonSet.YES_NO);
	
	if (response == ui.Button.YES) muteFormActiveSheetWarnings_(true);
	else                           muteFormActiveSheetWarnings_(false);
  }


  if (templateActiveSheetChanged_(sheet) &&
	 ! muteTemplateActiveSheetWarnings_()) {

	var ui = SpreadsheetApp.getUi();
	var templateActiveSheet = getSheetById_(sheet.getParent(), PropertiesService.getDocumentProperties().getProperty("legalese.templateActiveSheetId"));
	
	var response = ui.alert("Potential Template Mismatch",
							"Your template was previously generated by sheet " + templateActiveSheet.getSheetName() + " but you are now working on " + sheet.getSheetName() +".\nMute this warning?",
							ui.ButtonSet.YES_NO);
	
	if (response == ui.Button.YES) muteTemplateActiveSheetWarnings_(true);
	else                           muteTemplateActiveSheetWarnings_(false);
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
	setupOtherForms_();
	return;
  }
  var sheet = sheet || SpreadsheetApp.getActiveSheet();

  var ss = sheet.getParent();
  var entitiesByName = {};
  var readRows = readRows_(sheet, entitiesByName);
  var data   = readRows.terms;
  var config = readRows.config;

  var cell = sheet.getRange("E4");
  var form = ss.getFormUrl();

  if (form != undefined) {
    var ui = SpreadsheetApp.getUi();
    var response = ui.prompt('A form was previously created.', 'Reset it?', ui.ButtonSet.YES_NO);

	if (response.getSelectedButton() == ui.Button.NO) { return }
	cell.setValue("resetting form"); SpreadsheetApp.flush();

	// resetting the form internals isn't enough because the form title may have changed.
	// TODO: delete the old form. delete the old onSubmit Trigger. then recreate the form entirely from scratch.

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

  var origentityfields = data._origentityfields;
  Logger.log("origentityfields = " + origentityfields);
  for (var i in origentityfields) {
	var entityfield = origentityfields[i];
	Logger.log("entityfield "+i+" = " + entityfield.fieldname);
	if (entityfield.itemtype.match(/^list/)) {
	  var enums = entityfield.itemtype.split(' ');
	  enums.shift();

	  // TODO: get this out of the Data Validation https://developers.google.com/apps-script/reference/spreadsheet/data-validation
	  // instead of the Config section.
	  form.addListItem()
		.setTitle(entityfield.fieldname)
		.setRequired(entityfield.required)
		.setChoiceValues(enums)
		.setHelpText(entityfield.helptext);
	}
	else if (entityfield.itemtype.match(/^(email|number)/)) {
	  form.addTextItem()
		.setTitle(entityfield.fieldname)
		.setRequired(entityfield.required)
		.setHelpText(entityfield.helptext);
	  // in the future, when Google Apps Scripts adds validation to its FormApp, validate the input as a valid email address or number as appropriate.
	}
	else if (entityfield.itemtype.match(/^text/)) {
	  form.addTextItem()
		.setTitle(entityfield.fieldname)
		.setRequired(entityfield.required)
		.setHelpText(entityfield.helptext);
	}	  
	else if (entityfield.itemtype.match(/^hidden/)) {
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

  DriveApp.getRootFolder().removeFile(DriveApp.getFileById(form.getId()));
  DriveApp.getRootFolder().removeFile(DriveApp.getFileById(ss.getId()));

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

  var sheet = getSheetById_(SpreadsheetApp.getActiveSpreadsheet(), sheetId);
  var entitiesByName = {}
  var readRows = readRows_(sheet, entitiesByName);
  var data   = readRows.terms;
  var config = readRows.config;

  // add a row and insert the investor fields
  Logger.log("onFormSubmit: inserting a row after " + (parseInt(readRows._last_entity_row)+1));
  sheet.insertRowAfter(readRows._last_entity_row+1); // might need to update the commitment sum range
  var newrow = sheet.getRange(readRows._last_entity_row+2,1,1,sheet.getMaxColumns());
//  newrow.getCell(0,0).setValue("bar");

  // loop through the origentityfields inserting the new data in the right place.
  for (names in e.namedValues) {
	Logger.log("onFormSubmit: e.namedValues = " + names + ": "+e.namedValues[names][0]);
  }

  var origentityfields = data._origentityfields;
  Logger.log("onFormSubmit: origentityfields = " + origentityfields);

  for (var i = 0; i < origentityfields.length; i++) {
	var entityfield = origentityfields[i];

	// fill in the default party role
	if (i == 0 && entityfield == undefined) {
	  entityfield = { fieldname: "_party_role", column: 1 };
	  e.namedValues["_party_role"] = [ config.default_party_role.value ];
	  Logger.log("setting default party row in column 1 to %s", config.default_party_role.value);
	}
	  
	// fill in any fields which are hidden and have a default value configured. maybe in future we should extend the default-filling to all blank submissions
	else if (e.namedValues[entityfield.fieldname] == undefined) {
	  Logger.log("did not receive form submission for %s", entityfield.fieldname);

	  if (entityfield["default"] != undefined) {
		Logger.log("filling with default value %s", entityfield["default"]);
		e.namedValues[entityfield.fieldname] = [ entityfield["default"] ];
	  }
	  else {
		continue;
	  }
	}

	Logger.log("onFormSubmit: entityfield "+i+" (" + entityfield.fieldname+") (column="+entityfield.column+") = " + e.namedValues[entityfield.fieldname][0]);

	var newcell = newrow.getCell(1,parseInt(entityfield.column));
	Logger.log("onFormSubmit: setting value of cell to " + e.namedValues[entityfield.fieldname]);
	newcell.setValue(e.namedValues[entityfield.fieldname][0]);
  }
}

// ---------------------------------------------------------------------------------------------------------------- readRows
/**
 * populate a number of data structures, all kept in "toreturn".
 * you can think of this as a constructor, basically, that represents the sheet, but is agnostic as to the specific data.parties that are needed by each template.
 * the data.parties get filled in by the template matcher, because different templates involve different parties.
 *
 * the ENTITIES go into entitiesByName
 * the TERMS go into data.* directly.
 */
function readRows_(sheet, entitiesByName) {
  Logger.log("readRows_: will use sheet " + sheet.getName());
  var rows = sheet.getDataRange();
  var numRows  = rows.getNumRows();
  var values   = rows.getValues();
  var formulas = rows.getFormulas();

  var toreturn =   { terms            : {},
					 config           : {},
					 entitiesByName   : entitiesByName,
					 _origentityfields: [],
					 _entityfields    : [],
					 _last_entity_row : null,
					 // principal gets filled in later.
				   };

  var terms = toreturn.terms;
  var config = toreturn.config;
  var origentityfields = toreturn._origentityfields; // used by the form
  var entityfields = toreturn._entityfields;
  var principal, roles = {};

  var section = "prologue";
  var entityfieldorder = []; // table that remaps column number to order-in-the-form
  // maybe we should do it this way and just synthesize the partygroups as needed, along with any other filters.
  var previous = [];

  Logger.log("readRows: starting to parse %s / %s", sheet.getParent().getName(), sheet.getSheetName());

// get the formats for the B column -- else we won't know what currency the money fields are in.
  var term_formats = sheet.getRange(1,2,numRows).getNumberFormats();

  var es_num = 1; // for email ordering the EchoSign fields

  var seen_entities_before = false;

  for (var i = 0; i <= numRows - 1; i++) {
    var row = values[i];
	Logger.log("readRows: row " + i + ": processing row "+row[0]);
	// process header rows
	if (row.filter(function(c){return c.length > 0}).length == 0) { Logger.log("row %s is blank, skipping", i);  continue; }
    if      (row[0] == "KEY TERMS" ||
			 row[0] == "TERMS") { section="TERMS"; continue; }
    else if (row[0] == "IGNORE") { section = row[0]; continue; }
    else if (row[0] == "INCLUDE") {
	  // the typical startup agreement sheet INCLUDEs its Entities sheet which INCLUDEs JFDI.2014's Entities which INCLUDEs JFDI.Asia's Entities
	  var include_sheet;
	  var formula = formulas[i][1];
	  if (formula) {
		// =HYPERLINK("https://docs.google.com/a/jfdi.asia/spreadsheets/d/1Ix5OYS7EpmEIqA93S4_JWxV1OO82tRM0MLNj9C8IwHU/edit#gid=1249418813","Entities JFDI.2014")
		var res = formula.match(/=HYPERLINK\(".*\/([^\/]+)\/edit#gid=(\d+)/); // JS doesn't need us to backslash the / in [] but it helps emacs js-mode
		if (res) {
		  include_sheet = getSheetById_(SpreadsheetApp.openById(res[1]), res[2]);
		}
	  }
	  else {
		include_sheet = sheet.getParent().getSheetByName(row[1]);
	  }
	  
	  Logger.log("readRows(%s): encountered INCLUDE %s", sheet.getSheetName(), row[1]);
	  var includedReadRows = readRows_(include_sheet, entitiesByName);
	  Logger.log("readRows(%s): back from INCLUDE %s; toreturn.principal = %s",
				 sheet.getSheetName(), row[1], toreturn.principal ? toreturn.principal.name : undefined);
	  // hopefully we've learned about a bunch of new Entities directly into the entitiesByName shared dict.
	  // we throw away the returned object because we don't really care about the included sheet's terms or config.

	  if (principal == undefined) { principal = includedReadRows.principal }

	  continue;
	}
    else if (row[0] == "PARTYFORM_ORDER") { section=row[0]; for (var ki in row) { if (ki<1||row[ki]==undefined||!row[ki]){continue}
																				  entityfieldorder[ki] = row[ki];
																				  Logger.log("readRows: PARTYFORM_ORDER: entityfieldorder[%s] = %s", ki, row[ki]);
																				  origentityfields[entityfieldorder[ki]] = origentityfields[entityfieldorder[ki]]||{};
																				  origentityfields[entityfieldorder[ki]].column = parseInt(ki)+1;
																				  origentityfields[entityfieldorder[ki]].row    = i+1;
																				  Logger.log("readRows: learned that field with order "+row[ki]+ " is in row %s column %s ", origentityfields[entityfieldorder[ki]].row, origentityfields[entityfieldorder[ki]].column);
																				}
											continue;
										  }
    else if (row[0] == "PARTYFORM_HELPTEXT") { section=row[0]; for (var ki in row) { if (ki<1||row[ki]==undefined||entityfieldorder[ki]==undefined){continue}
																					 origentityfields[entityfieldorder[ki]].helptext = row[ki];
																				   }
											continue;
										  }
    else if (row[0] == "PARTYFORM_ITEMTYPE") { section=row[0]; for (var ki in row) { if (ki<1||row[ki]==undefined||entityfieldorder[ki]==undefined){continue}
																					 origentityfields[entityfieldorder[ki]].itemtype = row[ki];
																				   }
											continue;
										  }
    else if (row[0] == "PARTYFORM_DEFAULT") { section=row[0]; for (var ki in row) { if (ki<1||row[ki]==undefined||entityfieldorder[ki]==undefined||row[ki].length==0){continue}
																					Logger.log("readRows: learned default value for %s = %s", entityfieldorder[ki], row[ki]);
																					 origentityfields[entityfieldorder[ki]]["default"] = row[ki];
																				   }
											continue;
										  }
    else if (row[0] == "PARTYFORM_REQUIRED") { section=row[0]; for (var ki in row) { if (ki<1||row[ki]==undefined||entityfieldorder[ki]==undefined){continue}
																					 Logger.log("readRows: line "+i+" col "+ki+": learned that field with order "+entityfieldorder[ki]+ " has required="+row[ki]);
																					 origentityfields[entityfieldorder[ki]].required = row[ki];
																				   }
											continue;
										  }
    else if (row[0] == "ENTITIES" || row[0] == "PARTIES")   {
	  section = "ENTITIES";
	  if (! seen_entities_before) {
		seen_entities_before = true;
		entityfields = row;
		while (row[row.length-1] === "") { row.pop() }
		
		for (var ki in entityfields) {
		  if (ki < 1 || row[ki] == undefined) { continue }
          origentityfields[entityfieldorder[ki]] = origentityfields[entityfieldorder[ki]] || {};
          origentityfields[entityfieldorder[ki]].fieldname = row[ki];
		  // Logger.log("readRows: learned origentityfields["+entityfieldorder[ki]+"].fieldname="+row[ki]);
          entityfields[ki] = asvar_(entityfields[ki]);
		  Logger.log("readRows(%s): recorded entityfield[%s]=%s", sheet.getSheetName(), ki, entityfields[ki]);
		}
	  }
	  continue;
	}
	else if (row[0] == "CONFIGURATION") { section = row[0]; continue }
	else if (row[0] == "ROLES") { section = row[0]; continue; }

	// process data rows
    if (section == "TERMS") {
      if ( row[0].length == 0) { continue }

	  // TODO: do we need to ignore situations where row[0] !~ /:$/ ? subsection headings might be noisy.
	  var asvar = asvar_(row[0]);
      terms[           asvar] = formatify_(term_formats[i][0], row[1], sheet);
	  terms["_orig_" + asvar] = row[1];
	  Logger.log("readRows(%s): TERMS: %s --> %s", sheet.getSheetName(), row[1], terms[asvar]);
    }
	else if (section == "ROLES") { // principal relation entity. these are all strings. we attach roles later.
	  var relation  = asvar_(row[0]);
	  var entityname    = row[1];

	  roles[relation] = roles[relation] || [];
	  roles[relation].push(entityname);
      Logger.log("readRows(%s):         ROLES: learning party role %s = %s", sheet.getSheetName(), relation, entityname);
	}
    else if (section == "ENTITIES") {
      var entity = { _origin_spreadsheet_id:sheet.getParent().getId(),
					 _origin_sheet_id:sheet.getSheetId(),
					 _spreadsheet_row:i+1,
				   };
      var entity_formats = sheet.getRange(i+1,1,1,row.length).getNumberFormats();
	  toreturn._last_entity_row = i;

      for (var ki in entityfields) {
        if (ki < 1) { continue }
        var k = entityfields[ki];
        var v = formatify_(entity_formats[0][ki],row[ki], sheet);
        entity[k] = v;
      }
      var coreRelation = asvar_(row[0]);
	  if (coreRelation == undefined || ! coreRelation.length) { continue }

	  // all coreRelation relations in the ENTITIES section are defined relative to the principal, which is hardcoded as the first Company to appear
	  if (coreRelation == "company" && principal == undefined) { principal = entity }
	  if (coreRelation.toLowerCase() == "ignore") { Logger.log("ignoring %s line %s", coreRelation, entity.name); continue }

  // connect up the parties based on the relations learned from the ROLES section.
  // this establishes PRINCIPAL.roles.RELATION_NAME = [ party1, party2, ..., partyN ]
  // for instance, companyParty.roles.shareholder = [ alice, bob ]
      Logger.log("readRows: learning entity (core relation = %s), %s", coreRelation, entity);
	  roles[coreRelation] = roles[coreRelation] || [];
	  roles[coreRelation].push(entity.name);

	  if (entitiesByName[entity.name] != undefined) {
		Logger.log("WARNING: entity %s was previously defined somewhere in the include chain ... not clobbering.");
	  } else {
		// Define Global Parties Entity
		entitiesByName[entity.name] = entity;
	  }
    }
	else if (section == "CONFIGURATION") {

	  // each config row produces multiple representations:
	  // config.columna.values is an array of values -- if columna repeats, then values from last line only
	  // config.columna.dict is a dictionary of b: [c,d,e] across multiple lines
	  
	  Logger.log("CONF: row " + i + ": processing row "+row[0]);
	  
	  // populate the previous
	  var columna = asvar_(row[0]) || previous[0];
	  previous[0] = columna;

	  Logger.log("CONF: columna="+columna);
	  config[columna] = config[columna] || { asRange:null, values:null, dict:{}, tree:{} };
	  Logger.log("CONF: config[columna]="+config[columna]);

	  config[columna].asRange = sheet.getRange(i+1,1,1,sheet.getMaxColumns());
	  Logger.log("CONF: " + columna+".asRange=" + config[columna].asRange.getValues()[0].join(","));

	  var rowvalues = config[columna].asRange.getValues()[0];
	  while (rowvalues[rowvalues.length-1] === "") { rowvalues.pop() }
	  Logger.log("CONF: rowvalues = %s", rowvalues);

	  var descended = [columna];

	  var leftmost_nonblank = -1;
	  for (var j = 0; j < rowvalues.length; j++) {
		if (leftmost_nonblank == -1
			&& (! (rowvalues[j] === ""))) { leftmost_nonblank = j }
	  }
	  Logger.log("CONF: leftmost_nonblank=%s", leftmost_nonblank);

	  for (var j = 0; j < leftmost_nonblank; j++) {
		descended[j] = previous[j];
	  }
	  for (var j = leftmost_nonblank; j < rowvalues.length; j++) {
		if (j >= 1 && ! (rowvalues[j] === "")) { previous[j] = rowvalues[j] }
		descended[j] = rowvalues[j];
	  }
	  Logger.log("CONF: descended = %s", descended);

	  // build value -- config.a.value = b
	  config[columna].value = descended[1];

	  // build values -- config.a.values = [b,c,d]
	  config[columna].values = descended.slice(1);
	  Logger.log("CONF: " + columna+".values=%s", config[columna].values.join(","));

	  // build tree -- config.a.tree.b.c.d.e.f=g
	  treeify_(config[columna].tree, descended.slice(1));

	  // build dict -- config.a.dict.b = [c,d,e]
	  var columns_cde = config[columna].values.slice(1);
	  if (columns_cde[0] == undefined) { continue }
	  var columnb = asvar_(descended[1]);

	  config[columna].dict[columnb] = columns_cde;
	  Logger.log("CONF: %s", columna+".dict."+columnb+"=" + config[columna].dict[columnb].join(","));
	}
  }

  toreturn.principal = principal;
  Logger.log("readRows(%s): setting toreturn.principal = %s", sheet.getSheetName(), principal.name);

  toreturn.principal.roles = toreturn.principal.roles || {};

  // set up the principal's .roles property.
  // also configure the vassals' _role property, though nothing uses this at the moment.
  for (var k in roles) {
	toreturn.principal.roles[k] = roles[k];
	for (var pi in roles[k]) {
	  var entity = entitiesByName[roles[k][pi]];
	  entity._role = entity._role || {};
	  entity._role[toreturn.principal.name] = entity._role[toreturn.principal.name] || [];
	  entity._role[toreturn.principal.name].push(k);
	  Logger.log("readRows(%s): VASSAL: entity %s knows that it is a %s to %s",
				 sheet.getSheetName(),
				 entity.name,
				 k,
				 toreturn.principal.name);
	}
  }
  Logger.log("readRows(%s): have contributed to entitiesByName = %s", sheet.getSheetName(), entitiesByName);
//  Logger.log("readRows: config = %s\n", JSON.stringify(config,null,"  "));
  return toreturn;
}

// ---------------------------------------------------------------------------------------------------------------- getPartyCells_
// TODO: make this go away -- let's just log the mailing output in one place, rather than row by row.
function getPartyCells_(sheet, readrows, party) {
  Logger.log("getPartyCells: looking to return a dict of entityfieldname to cell, for party %s", party.name);
  Logger.log("getPartyCells: party %s comes from spreadsheet row %s", party.name, party._spreadsheet_row);
  Logger.log("getPartyCells: the fieldname map looks like this: %s", readrows._entityfields);
  Logger.log("getPartyCells: so the cell that matters for legalese_status should be row %s, col %s", party._spreadsheet_row, readrows._entityfields.indexOf("legalese_status")+1);
  Logger.log("getPartyCells: calling (getRange %s,%s,%s,%s)", party._spreadsheet_row, 1, 1, readrows._entityfields.length+1);
  var range = sheet.getRange(party._spreadsheet_row, 1, 1, readrows._entityfields.length+1);
  Logger.log("pulled range %s", JSON.stringify(range.getValues()));
  var toreturn = {};
  for (var f = 0; f < readrows._entityfields.length ; f++) {
	Logger.log("toreturn[%s] = range.getCell(%s,%s)", readrows._entityfields[f], 0+1,f+1);
	toreturn[readrows._entityfields[f]] = range.getCell(0+1,f+1);
  }
  return toreturn;
}

// ---------------------------------------------------------------------------------------------------------------- asvar_
function asvar_(str) {
  if (str == undefined) { return undefined }
  return str.toString().replace(/:/g, "").toLowerCase().replace(/\W/g, "_").toLowerCase();
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
function formatify_(format, string, sheet) {
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
    // INFO: expanding term Fri Dec 19 2014 00:00:00 GMT+0800 (HKT) with format yyyy"-"mm"-"dd
    // INFO: expanding term Thu Jan 15 2015 00:00:00 GMT+0800 (HKT) with format yyyy"-"mm"-"dd
      // toreturn = string.toString().substr(0,15).replace(/ 0/, " ");  // Jan 01 2015 => Jan 1 2015

	  if (string.toString().length == 0) { return "" }
//	  Logger.log("input date: " + string.toString().substr(0,15));
	  toreturn = Utilities.formatDate(new Date(string.toString().substr(0,15)),
									  sheet.getParent().getSpreadsheetTimeZone(),
									  "EEEE d MMMM YYYY");
//	  Logger.log("output date: " + toreturn);

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
// a whole bunch of clausehint_()s at the front of the file
function clausehint_(clausetext, pathindex, uniqtext) {
  hintclause2num[uniqtext || clausetext] = pathindex.join(".");
}

// ---------------------------------------------------------------------------------------------------------------- newclause
function newclause_(level, clausetext, uniqtext, tag) {
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
// the HTML template is filled in a single pass, so forward references from showclause_() to newclause_() will dangle.
// fortunately the newclauses are populated by xml2html so we can muster a hint database.
//
function clausenum_(clausetext) {
  return clausetext2num[clausetext] || hintclause2num[clausetext] || "<<CLAUSE XREF MISSING>>";
}
  
// ---------------------------------------------------------------------------------------------------------------- showclause
function showclause_(clausetext) {
    return clausenum + " (" + clausetext + ")";
}


// ---------------------------------------------------------------------------------------------------------------- otherSheets
function otherSheets_() {
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
	var sheet = getSheetById_(ss, myRow.getValues()[0][1])
	Logger.log("smoochy says otherSheets: sheet %s is on row %s", i.toString(), myRow.getRowIndex().toString());
	myRow.getCell(1,3).setValue("=HYPERLINK(\""
								+sheet.getParent().getUrl()
								+"#gid="
								+sheet.getSheetId()
								+"\",\""
								+sheet.getParent().getName() + " / " + sheet.getName()
								+"\")");
	toreturn.push(sheet);
  }
  return toreturn;
}

// ---------------------------------------------------------------------------------------------------------------- quicktest
function quicktest() {

  var toreturn = "";
  var mydate = new Date("Mar 1 2015 12:02:03 GMT+0000 (UTC)");
  toreturn = toreturn + "date: " + mydate.toString() + "\n";
  toreturn = toreturn + "mar 1 UTC: " + Utilities.formatDate(mydate, "UTC", "EEEE d MMMM YYYY HH:mm:ss") + "\n";
  toreturn = toreturn + "mar 1 SGT: " + Utilities.formatDate(mydate, "SGT", "EEEE d MMMM YYYY HH:mm:ss") + "\n";
  toreturn = toreturn + "mar 1 HKT: " + Utilities.formatDate(mydate, "HKT", "EEEE d MMMM YYYY HH:mm:ss") + "\n";
  toreturn = toreturn + "mar 1 GMT: " + Utilities.formatDate(mydate, "GMT", "EEEE d MMMM YYYY HH:mm:ss") + "\n";
  toreturn = toreturn + "mar 1 Asia/Singapore:   " + Utilities.formatDate(mydate,     "Asia/Singapore", "EEEE d MMMM YYYY HH:mm:ss") + "\n";
  toreturn = toreturn + "spreadsheet timezone = " + SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone() + "\n";
  Logger.log(toreturn);

 // [15-03-10 13:29:05:951 HKT] date: Sun Mar 01 2015 20:02:03 GMT+0800 (HKT)
 // mar 1 UTC: Sunday 1 March 2015 12:02:03
 // mar 1 SGT: Sunday 1 March 2015 12:02:03
 // mar 1 HKT: Sunday 1 March 2015 12:02:03
 // mar 1 GMT: Sunday 1 March 2015 12:02:03
 // mar 1 Asia/Singapore:   Sunday 1 March 2015 20:02:03
 //  spreadsheet timezone = Asia/Singapore

  
}

// ---------------------------------------------------------------------------------------------------------------- uniqueKey_
function uniqueKey_(sheet) {
  var ss = sheet.getParent();
  return ss.getId() + "/" + sheet.getSheetId();
}

// ---------------------------------------------------------------------------------------------------------------- setupOtherForms_
function setupOtherForms_() {
  var sheets = otherSheets_();
  for (var i = 0; i < sheets.length; i++) {
	var sheet = sheets[i];
	setupForm_(sheet);
	var myRow = SpreadsheetApp.getActiveRange().getSheet().getRange(SpreadsheetApp.getActiveRange().getRow()+i, 1, 1, 10);
	Logger.log("smoochy says setupOtherForms_: sheet %s is on row %s", i.toString(), myRow.getRowIndex().toString());
	myRow.getCell(1,7).setValue('=IMPORTRANGE(A'
								+myRow.getRowIndex()
								+',"Founder Agreement!e4")');
  }
}

// ---------------------------------------------------------------------------------------------------------------- fillOtherTemplates_
function fillOtherTemplates_() {
  var sheets = otherSheets_();
  for (var i = 0; i < sheets.length; i++) {
	var sheet = sheets[i];
	Logger.log("will generate template for " + sheet.getName());
	fillTemplates(sheet);

	var uniq = uniqueKey_(sheet);

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

// ---------------------------------------------------------------------------------------------------------------- uploadOtherAgreements_
function uploadOtherAgreements_() {
  var sheets = otherSheets_();
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

// you may be tempted to open this up so that the spreadsheet can specify any URL.
// this is unwise, because the XML template runs with the same privileges as this script,
// and if you randomly execute templates from all over the Internet, sooner or later you will regret it.

  { name:"strikeoff_financial_report_xml", title:"Financial Report",
	url:"http://www.legalese.io/templates/jfdi.asia/strikeoff_financial_report.xml",
	parties:{to:["director"], cc:["corporate_secretary"]},
	nocache:true,
  },
  { name:"change_of_address_xml", title:"Resolutions to Change Registered Address",
	url:"http://www.legalese.io/templates/jfdi.asia/dr_change_of_address.xml",
	parties:{to:["director"], cc:["corporate_secretary"]},
  },
  { name:"strikeoff_bank_closure_xml", title:"Resolutions to Close Bank Accounts",
	url:"http://www.legalese.io/templates/jfdi.asia/strikeoff_directors-bank-closure.xml",
	parties:{to:["director"], cc:["corporate_secretary"]},
  },
  { name:"strikeoff_accountant_retention_xml", title:"Retainer of Accountant for Financial Statements",
	url:"http://www.legalese.io/templates/jfdi.asia/strikeoff_accountant-retention.xml",
	parties:{to:["accountant", "director"]},
  },
  { name:"strikeoff_financials_letter_xml", title:"Letter to Accountant regarding Financial Statements",
	url:"http://www.legalese.io/templates/jfdi.asia/strikeoff_financials-letter.xml",
	parties:{to:["director"], cc:["accountant"]},
  },
  { name:"strikeoff_financials_letter_xml", title:"Letter to Accountant regarding Financial Statements",
	url:"http://www.legalese.io/templates/jfdi.asia/strikeoff_financials-letter.xml",
	parties:{to:["director"], cc:["accountant"]},
  },
  { name:"strikeoff_indemnity_xml", title:"Directors' Indemnity regarding Accounts",
	url:"http://www.legalese.io/templates/jfdi.asia/strikeoff_indemnity.xml",
	parties:{to:["director"], cc:["corporate_secretary"]},
  },
  { name:"strikeoff_report_xml", title:"DR for Report and Statement",
	url:"http://www.legalese.io/templates/jfdi.asia/strikeoff_directors-report-and-statement.xml",
	parties:{to:["director"], cc:["corporate_secretary"]},
  },
  { name:"strikeoff_application_xml", title:"Instruction to Corporate Secretary",
	url:"http://www.legalese.io/templates/jfdi.asia/strikeoff_application.xml",
	parties:{to:["director"], cc:["corporate_secretary"]},
  },
  { name:"strikeoff_acra_declaration_xml", title:"Directors' Declaration to ACRA",
	url:"http://www.legalese.io/templates/jfdi.asia/strikeoff_directors-declaration.xml",
	parties:{to:["director"], cc:["corporate_secretary"]},
  },
  { name:"corpsec_allotment_xml", title:"Instruction to Corpsec for Allotment",
	url:"http://www.legalese.io/templates/jfdi.asia/corpsec-allotment.xml",
	parties:{to:["director"], cc:["corporate_secretary"]},
  },
  { name:"dr_allotment_xml", title:"Directors' Resolution for Allotment",
	url:"http://www.legalese.io/templates/jfdi.asia/dr-allotment.xml",
	parties:{to:["director"],cc:["corporate_secretary"]},
  },
  { name:"jfdi_2014_rcps_xml", title:"JFDI.2014 Subscription Agreement",
	url:"jfdi_2014_rcps_xml.html",
	parties:{to:["promoter", "company"],cc:["corporate_secretary"]},
	explode:"new_investor",
  },
  { name:"kissing_xml", title:"KISS (Singapore)",
	url:"http://www.legalese.io/templates/jfdi.asia/kissing.xml",
	parties:{to:["founder", "company"],cc:["corporate_secretary"]},
	explode:"investor",
  },
  { name:"strikeoff_shareholders_xml", title:"Striking Off for Shareholders",
	url:"http://www.legalese.io/templates/jfdi.asia/strikeoff_shareholders.xml",
	parties:{to:["director[0]",],cc:[]},
	explode:"shareholder",
  },
  { name:"test_templatespec_xml", title:"Test templateSpec",
	url:"http://www.legalese.io/templates/jfdi.asia/test-templatespec.xml",
	parties:{to:["company[0]"],cc:["founder"]},
  },
  { name:"employment_agreement_xml", title:"Employment Agreement",
	url:"http://www.legalese.io/templates/jfdi.asia/employment-agreement.xml",
	parties:{to:["employee","company"],cc:[]},
  },
  { name:"termsheet_xml", title:"Seed Term Sheet",
	url:"http://www.legalese.io/templates/jfdi.asia/termsheet.xml",
	parties:{to:[],cc:[]},
  },
  { name:"preemptive_notice_xml", title:"Pre-Emptive Notice to Shareholders",
	url:"http://www.legalese.io/templates/jfdi.asia/preemptive_notice.xml",
	parties:{to:["shareholder"],cc:["company"]},
  },
  { name:"preemptive_waiver_xml", title:"Pre-Emptive Notice for Waiver",
	url:"http://www.legalese.io/templates/jfdi.asia/preemptive_waiver.xml",
	parties:{to:[],cc:["corporate_secretary","company"]},
	explode: "shareholder",
  },
  { name:"loan_waiver_xml", title:"Waiver of Convertible Loan",
	url:"http://www.legalese.io/templates/jfdi.asia/convertible_loan_waiver.xml",
	parties:{to:["jfdi_corporate_representative"],cc:["corporate_secretary","accountant"]},
  },
  { name:"simplified_note_xml", title:"Simplified Convertible Loan Agreement",
	url:"http://www.legalese.io/templates/jfdi.asia/simplified_note.xml",
	parties:{to:["investor","company"],cc:["corporate_secretary","accountant"]},
  },
  { name:"founder_agreement_xml", title:"JFDI Accelerate Founder Agreement",
	url:"http://www.legalese.io/templates/jfdi.asia/founderagreement.xml",
	parties:{to:["founder","investor"], cc:["corporate_secretary"]},
  },
  { name:"dora_xml", title:"DORA",
	url:"http://www.legalese.io/templates/jfdi.asia/dora-signatures.xml",
	parties:{to:["new_investor","shareholder"],cc:["corporate_secretary","company"]},
  },
  { name:"inc_signature", title:"signature component",
	url:"http://www.legalese.io/templates/jfdi.asia/inc_signature.xml"
  },
  { name:"inc_party", title:"party component",
	url:"http://www.legalese.io/templates/jfdi.asia/inc_party.xml"
  },

  ];
return availables;
};

// ---------------------------------------------------------------------------------------------------------------- desiredTemplates_
function desiredTemplates_(config) {
  var toreturn = [];
  for (var i in config.templates.tree) {
	var field = asvar_(i);
	toreturn.push(field);
  }
  Logger.log("desiredTemplates_: returning %s", toreturn);
  return toreturn;
}

function suitableTemplates_(config) {
  var availables = availableTemplates_();
  Logger.log("available templates are %s", availables);
  var desireds = desiredTemplates_(config);
  var suitables = intersect_(availables, desireds);
  // this is slightly buggy. kissing, kissing1, kissing2, didn't work
  return suitables;
}

// ---------------------------------------------------------------------------------------------------------------- intersect_
// yes, this is O(nm) but for small n,m it should be OK
function intersect_(array1, array2) {
  return array1.filter(function(n) { return array2.indexOf(n.name) != -1 || array2.indexOf(n.name.replace(/_xml/,"")) != -1 });
}

// ---------------------------------------------------------------------------------------------------------------- obtainTemplate_
// obtainTemplate
// we can pull a generic HTML template from somewhere else,
// or it can be one of the project's HTML files.
function obtainTemplate_(url, nocache) {
  Logger.log("obtainTemplate_(%s) called", url);

  // we're actually running within a single script invocation so maybe we should find a more intelligent way to cache within a single session.
  // otherwise this risks not picking up changes

  if (url.match(/^http/)) {
	if (nocache != true) {
	  var cache = CacheService.getDocumentCache();
	  var cached = cache.get(url);
	  if (cached != null) {
		return HtmlService.createTemplate(cached);
	  }
	}

	var result = UrlFetchApp.fetch(url);
	var contents = result.getContentText();
	// the cache service can only store keys of up to 250 characters and content of up to 100k, so over that, we don't cache.
	if (nocache != true && contents.length < 100000 && url.length < 250) {
	  cache.put(url, contents, 60);
	}
	Logger.log("obtained template %s, length %s bytes", url, contents.length);
	return HtmlService.createTemplate(contents);
  }
  else return HtmlService.createTemplateFromFile(url);
}


function templateParties(sheet, readRows, sourceTemplate) {
  /*
   * establish the appropriate data.parties.* for a given template.
   * 
   * data.parties.founder.*, data.parties.existing_shareholder.*, data.parties.company.*, data.parties.investor.* as arrays
   *
   * we also track the mailing status here
   */
  Logger.log("templateParties: running for %s", sourceTemplate.name);
  // consult the Template DTD to see what roles are involved in the template

  Logger.log("templateParties: hardcoding parties.company = %s", parties.company);
  Logger.log("templateParties: template parties = %s", sourceTemplate.parties);

		}
	  }
	}
  }
  return parties;
}

function plusNum (num, email) {
  // turn (0, mengwong@jfdi.asia) to mengwong+0@jfdi.asia
  var localpart, domain;
  localpart = email.split("@")[0];
  domain    = email.split("@")[1];
  return localpart + "+" + num.toString() + "@" + domain;
}

function uniq_( arr ) {
  return arr.reverse().filter(function (e, i, arr) {
    return arr.indexOf(e, i+1) === -1;
  }).reverse();
}

// see documentation in notes-to-self.org
function docsetEmails(sheet, readRows, concatenateMode, parties, suitables) {
  this.sheet = sheet;
  this.readRows = readRows;
  this.concatenateMode = concatenateMode;
  this.parties = parties;
  this.suitables = suitables;

  this.esNumForTemplate = { };

  Logger.log("docsetEmails(%s): now I will figure out who gets which PDFs.",
			 sheet.getSheetName());

  // populate rcpts
  this._rcpts = { exploders: { },
				 normals: { } };

  for (var i in suitables) {
    var sourceTemplate = suitables[i];
	var to_list = [], cc_list = [];
	for (var mailtype in sourceTemplate.parties) {
	  Logger.log("docsetEmails: sourceTemplate %s: expanding mailtype %s",
				 sourceTemplate.name, mailtype);
	  for (var i in sourceTemplate.parties[mailtype]) {
		var partytype = sourceTemplate.parties[mailtype][i];
		Logger.log("docsetEmails: discovered %s: %s", mailtype, partytype);
		if (readRows.principal.roles[partytype] == undefined) {
		  Logger.log("docsetEmails:   principal does not possess a defined %s role!");
		  continue;
		}
		for (var j in parties[partytype]) {
		  var entity = parties[partytype][j];
		  Logger.log("templateParties:     what to do with entity %s?", entity.name);
		  var email_to_cc = email_to_cc_(entity.email);
		  if (mailtype == "to") {
			to_list = uniq_(to_list.concat(email_to_cc[0]));
			cc_list = uniq_(cc_list.concat(email_to_cc[1])); // quietly send 2ndliners to cc
		  } else { // mailtype == "cc"
			cc_list = uniq_(cc_list.concat(email_to_cc[0]); // all go to cc
			                       .concat(email_to_cc[1]));
		  }
		}
	  }
	}
	if (sourceTemplate.explode == undefined) {
	  this._rcpts.normals[sourceTemplate.name]={to:to_list, cc:cc_list};
	  Logger.log("docsetEmails: defining this._rcpts.normals[%s]={to:%s}",sourceTemplate.name, to_list);
	  Logger.log("docsetEmails: defining this._rcpts.normals[%s]={cc:%s}",sourceTemplate.name, cc_list);
	} else { // explode first and then set this._rcpts.exploders
	  Logger.log("docsetEmails(): will explode %s", sourceTemplate.explode);
	  readme.getBody().appendParagraph("docsetEmails(): will explode template with one per doc for " + sourceTemplate.explode);

      for (var j in this.parties[sourceTemplate.explode]) {
		var entity = parties[sourceTemplate.explode][j];
		// we step through the desired {investor,company}.* arrays.
		// we set the singular as we step through.
		var mytitle = sourceTemplate.name + " for " + entity.name;
		Logger.log("docsetEmails(): preparing exploded %s for %s %s", mytitle, to_explode, entity.name);
		var email_to_cc = email_to_cc_(entity.email);
		this._rcpts.exploders[mytitle] = {
		  to:uniq_(to_list.concat(email_to_cc[0])),
		  cc:uniq_(cc_list.concat(email_to_cc[1])),
		};
		Logger.log("docsetEmails: defining this._rcpts.exploders[%s]={to:%s}",mytitle,to_list);
		Logger.log("docsetEmails: defining this._rcpts.exploders[%s]={cc:%s}",mytitle,cc_list);
	  }
	}
  }

  this.Rcpts = function(sourceTemplates, explodeEntity) {
	var es_num = 1;
	// clear es_nums
	for (var e in entitiesByName) { entitiesByName[e]._es_num = null; entitiesByName[e]._to_email = null; }

	Logger.log("docsetEmails.partiesFor: %s, %s", sourceTemplates.map(function(st){return st.name}), explodeEntity);
	// pull up all the entities relevant to this particular set of sourceTemplates
	// this should be easy, we've already done the hard work above.
	var all_to = [], all_cc = [];
	for (var st in sourceTemplates) {
	  var sourceTemplate = sourceTemplates[st];
	  if (explodeEntity) {
		var mytitle = sourceTemplate.name + " for " + explodeEntity.name;
		all_to = all_to.concat(this._rcpts.exploders[mytitle].to);
		all_cc = all_cc.concat(this._rcpts.exploders[mytitle].cc);
		// set up the es_nums for each entity.
		entity._es_num = es_num++;
		entity._to_email = this.config.email_override ? plusNum(es_num, this.config.email_override.values[0]) : entity.email;
	  } else {
		all_to = all_to.concat(this._rcpts.normals[sourceTemplate.name].to);
		all_cc = all_cc.concat(this._rcpts.normals[sourceTemplate.name].cc);
	  }
	}

	entity._unmailed = true;
	entity._es_num = es_num++;


	  // new style: data.party.x
	  // old style: data.x, deprecated
	  newTemplate.data.party = newTemplate.data.party || {};
		newTemplate.data      [to_explode] = entity; // technically this doesn't belong here.
		newTemplate.data.party[to_explode] = entity;


  };
  this.getTo = function(sourceTemplate) { };
  this.getCC = function(sourceTemplate) { };
}


// ---------------------------------------------------------------------------------------------------------------- fillTemplates
function fillTemplates(sheet) {

  var sheetPassedIn = ! (sheet == undefined);
  if (! sheetPassedIn && SpreadsheetApp.getActiveSheet().getName() == "controller") {
	Logger.log("in controller mode, switching to fillOtherTemplates()");
	fillOtherTemplates_();
	return;
  }
  sheet = sheet || SpreadsheetApp.getActiveSheet();
  var entitiesByName = {};
  var readRows = readRows_(sheet, entitiesByName);
  var templatedata   = readRows.terms;
  var config         = readRows.config;
  templatedata.clauses = {};
  templatedata._config = config;

  if (! sheetPassedIn) { alertIfActiveSheetChanged_(sheet); }

  var uniq = uniqueKey_(sheet);
  // in the future we will probably need several subfolders, one for each template family.
  // and when that time comes we won't want to just send all the PDFs -- we'll need a more structured way to let the user decide which PDFs to send to echosign.
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

  // hardcode some useful expressions
  templatedata.xml_declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  templatedata.whitespace_handling_use_tags = '<?whitespace-handling use-tags?>';
  templatedata.whitespace_handling_use_characters = '<?whitespace-handling use-characters?>';
  templatedata._timezone = sheet.getParent().getSpreadsheetTimeZone();

  var suitables = suitableTemplates_(config);
  Logger.log("resolved suitables = %s", suitables.map(function(e){return e.url}).join(", "));

  // the parties{} for a given docset are always the same -- all the defined roles are available
  var parties = { };
  templatedata.company = templatedata.parties.company[0];
  // each role shows a list of names. populate the parties array with a list of expanded entity objects.
  for (var role in readRows.principal.roles) {
	for (var i in readRows.principal.roles[role]) {
	  var partyName = readRows.principal.roles[role][i];
	  if (readRows.entitiesByName[partyName]) {
		parties[role] = parties[role] || [];
		parties[role].push(readRows.entitiesByName[partyName]);
	  }
	  else {
		Logger.log("WARNING: the Roles section defines a party %s which is not defined in an Entities section, so omitting from the data.parties list.", partyName);
	  }
	}
  }
  if (parties["company"] == undefined) { company:[readRows.principal]; }
  templatedata._entitiesByName = readRows.entitiesByName;

  var docsetEmails = new docsetEmails(sheet, readRows, false, parties, suitables);

  for (var i in suitables) {
    var sourceTemplate = suitables[i];

	readme.getBody().appendParagraph(sourceTemplate.name).setHeading(DocumentApp.ParagraphHeading.HEADING2);

    var url = sourceTemplate.url;
    var newTemplate = obtainTemplate_(url, sourceTemplate.nocache);
	Logger.log("here is where we decide to dump template.");
	if (config.dump_template && config.dump_template.values[0] == true) {
	  Logger.log("TEMPLATE: " + newTemplate.getCode());
	}
    newTemplate.data = templatedata;
	var sans_xml = sourceTemplate.name.replace(/_xml|xml_/,"");

	// populate the es_nums within the party entities
	newTemplate.data.parties = docsetEmails.partiesFor(sourceTemplate);
//	Logger.log("templatedata.parties = %s", JSON.stringify(templatedata.parties));

		fillTemplate_(newTemplate, sourceTemplate, mytitle, folder);
		readme.getBody().appendParagraph("created " + mytitle
										 + " for " + to_explode
										 + " " + newTemplate.data[to_explode].name);
	  }

	} else {
	  Logger.log("no explosion; doing all parties in one doc ... " + sourceTemplate.url);
	  fillTemplate_(newTemplate, sourceTemplate, sourceTemplate.title, folder); // todo: make the title configured in the spreadsheet itself, and get rid of the hardcoded title from the availabletemplates code below.
	  readme.getBody().appendParagraph("created " + sourceTemplate.title);
	  readme.getBody().appendParagraph("doing all parties in one doc. to do one doc for each party, set explode=investor or whatever partytype in the configuration section of the spreadsheet.");
	}
	Logger.log("finished suitable %s", url);
  }

  var ROBOT = 'robot@legalese.io';
  Logger.log("sharing %s with %s", folder.getName(), ROBOT);
  folder.addEditor(ROBOT);

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

function fillTemplate_(newTemplate, sourceTemplate, mytitle, folder) {
  // reset "globals"
  clauseroot = [];
  clausetext2num = {};
  newTemplate.signature_comment = null;
  var filledHTML = newTemplate.evaluate().setSandboxMode(HtmlService.SandboxMode.IFRAME).getContent();
  var xmlfile;

  if (sourceTemplate.url.match(/[._]xml(\.html)?$/)) {
	xmlfile = DriveApp.createFile(mytitle+".xml", filledHTML, 'text/xml');
	folder.addFile(xmlfile);
	DriveApp.getRootFolder().removeFile(xmlfile);
  }
  else {
	Logger.log("we only support xml file types. i am not happy about %s", sourceTemplate.url);
  }

  Logger.log("finished " + mytitle);
}

// ---------------------------------------------------------------------------------------------------------------- include
// used inside <? ?>
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

// ---------------------------------------------------------------------------------------------------------------- newlinesToCommas
// used inside <? ?> to convert a multiline address to a singleline address for party-section purposes
function newlinesToCommas(str) {
  Logger.log("converting newlinesToCommas");
  if (str == undefined) { Logger.log("newlinesToCommas: undefined!"); return undefined }
  return str.replace(/\n/g, ", ");
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
  var docfile = DriveApp.getFileById(doc.getId());
  folder.addFile(docfile);
  DriveApp.getRootFolder().removeFile(docfile);

  doc.getBody().appendParagraph("this was created by Legalese.");

  var para = doc.getBody().appendParagraph("The origin spreadsheet is ");
  var text = para.appendText(spreadsheet.getName() + ", " + sheet.getName());
  text.setLinkUrl(spreadsheet.getUrl() + "#gid=" + sheet.getSheetId());

  doc.getBody().appendParagraph("You will see a bunch of XMLs in the folder. To create PDFs, share the folder with robot@legalese.io");

  var logs_para = doc.getBody().appendParagraph("Logs");
  logs_para.setHeading(DocumentApp.ParagraphHeading.HEADING1);

  Logger.log("run started");
  var uniq = uniqueKey_(sheet);
  PropertiesService.getDocumentProperties().setProperty("legalese."+uniq+".readme.id", JSON.stringify(doc.getId()));
  return doc;
}

function getReadme_(sheet) {
  var uniq = uniqueKey_(sheet);
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

// ---------------------------------------------------------------------------------------------------------------- showStyleAttributes_
function showStyleAttributes_() {
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

// ---------------------------------------------------------------------------------------------------------------- resetDocumentProperties_
// utility function to reset userproperties
function resetDocumentProperties_(which) {
  var props = PropertiesService.getDocumentProperties();
  if (which == "all") props.deleteAllProperties();
  else props.deleteProperty(which);
}

// ---------------------------------------------------------------------------------------------------------------- getEchoSignService_
// oAuth integration with EchoSign
// EchoSign uses OAuth 2
// so we grabbed https://github.com/googlesamples/apps-script-oauth2
// and we turned on the library.
//
// the redirect url is https://script.google.com/macros/d/{PROJECT KEY}/usercallback

function getEchoSignService_() {
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
      .setScope('agreement_read agreement_send agreement_write user_login');

  var ssid = SpreadsheetApp.getActiveSpreadsheet().getId();
  var ssname = SpreadsheetApp.getActiveSpreadsheet().getName();

  // TODO: see line 1254 of showSidebar. refactor this chunk so that it's available for showSidebar's purposes.
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
	clientId:"B9HLGXXT4F246T", 
	clientSecret:"3b92fc357f3bc9cb23ecd18adb3694b5", 
	projectKey:"M6VMONjB762l0FdR-z7tWO3YH5ITXFjPS" },
  };

  if (esApps[ssid] != undefined) { ssname = ssid }
  if (esApps[ssname] == undefined) {
	Logger.log("unable to identify EchoSign OAuth credentials for this spreadsheet / project.");
	return null;
  }

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
  var echosignService = getEchoSignService_();
  if (echosignService == null) { return } // don't show the sidebar if we're not associated with an echosign api.

  echosignService.reset();
  // blow away the previous oauth, because there's a problem with using the refresh token after the access token expires after the first hour.

  // TODO: don't show the sidebar if our spreadsheet's project doesn't have an associated openid at the echosign end.
  // because sometimes the controller does the thing, and this version of code.gs is only used for the form submit callback,
  // but not for Send to EchoSign.

  if (echosignService.hasAccess()) {
	Logger.log("showSidebar: we have access. doing nothing.");
  } else {
	Logger.log("showSidebar: we lack access. showing sidebar");
    var authorizationUrl = echosignService.getAuthorizationUrl();

	var myTemplate = '<p><a href="<?= authorizationUrl ?>" target="_blank">Authorize EchoSign</a>. ' +
      'Close this sidebar when authorization completes.</p>';

//	if (templateActiveSheetChanged_(sheet)) {
//	  var formActiveSheet = PropertiesService.getDocumentProperties().getProperty("legalese."+sheet.getParent().getId()+".formActiveSheetId");
//	  myTemplate = myTemplate + '<h2>Potential Form Mismatch</h2><p>Active sheet may have changed. If you\'re working with this sheet, you might want to recreate the form so that form submissions go here instead.</p>';
//	}

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
  var echosignService = getEchoSignService_();
  var isAuthorized = echosignService.handleCallback(request);
  if (isAuthorized) {
    return HtmlService.createHtmlOutput('Success! You can close this tab.\nBTW the token property is ' +  PropertiesService.getDocumentProperties().getProperty("oauth2.echosign"));
  } else {
    return HtmlService.createHtmlOutput('Denied. You can close this tab.');
  }
}

// ---------------------------------------------------------------------------------------------------------------- getLibraryDocuments_
function getLibraryDocuments_() {
  var api = getEchoSignService_();
  var response = UrlFetchApp.fetch(api.APIbaseUrl + '/libraryDocuments',
								   { headers: { "Access-Token": api.getAccessToken() } });

  SpreadsheetApp.getUi().alert(response.getContentText());
}

function allPDFs_(folder) {
  var folders = folder.getFolders();
  var files = folder.getFilesByType("application/pdf");
  var pdfs = [];
  while (  files.hasNext()) { pdfs= pdfs.concat(          files.next());  }
  while (folders.hasNext()) { pdfs= pdfs.concat(allPDFs_(folders.next())); }
  Logger.log("all PDFs under folder = %s", pdfs);
  return pdfs;
}

// ---------------------------------------------------------------------------------------------------------------- uploadPDFsToEchoSign_
// upload all the PDFs in the Folder
// returns an array of the transientDocumentIds of all the PDFs uploaded to Echosign.
function uploadPDFsToEchoSign_(sheet) {
  var api = getEchoSignService_();
  var o = { headers: { "Access-Token": api.getAccessToken() } };
  o.method = "post";

  var uniq = uniqueKey_(sheet);

  var folderId   = JSON.parse(PropertiesService.getDocumentProperties().getProperty("legalese."+uniq+".folder.id"));
  var folderName = JSON.parse(PropertiesService.getDocumentProperties().getProperty("legalese."+uniq+".folder.name"));
  Logger.log("uploadPDFsToEchoSign: for spreadsheet %s, folder.id = %s", uniq, folderId);
  if (folderId == undefined) {
	SpreadsheetApp.getUi().alert("Not sure which folder contains PDFs.\nPlease regenerate documents by clicking Legalese / Generate Docs");
	return;
  }
  var folder = DriveApp.getFolderById(folderId);
  var pdfs = allPDFs_(folder);
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

// ---------------------------------------------------------------------------------------------------------------- showDocumentProperties_
function showDocumentProperties_() {
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

// ---------------------------------------------------------------------------------------------------------------- fauxMegaUpload_
// upload a document to the template library
function fauxMegaUpload_() {
  // we do this using the web UI
}

// ---------------------------------------------------------------------------------------------------------------- fauxMegaSign_
// send a particular document from the template library for faux megasign
function fauxMegaSign(sheet) {
  var sheetPassedIn = ! (sheet == undefined);
  sheet = sheet || SpreadsheetApp.getActiveSheet();
  var entitiesByName = {};
  var readRows = readRows_(sheet, entitiesByName);
  var terms    = readRows.terms;
  var config   = readRows.config;

  alertIfActiveSheetChanged_(sheet);

  var parties = terms.parties;
  var to_list = [];
  var cc_list = parties._allparties.filter(function(party){return party.legalese_status.toLowerCase()=="cc"}); // TODO: get this a different way
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
	  party._commit_update_to = getPartyCells_(sheet, terms, party);
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
	party._commit_update_cc = getPartyCells_(sheet, terms, party);
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
								terms,
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
  // exploded docs need to have a different set of email recipients for each document.

  var echosignService = getEchoSignService_();
  // blow away the previous oauth, because there's a problem with using the refresh token after the access token expires after the first hour.
  if (!echosignService.hasAccess()) {
	SpreadsheetApp.getUi().alert("we don't have echosign access. Reload this page so the sidebar appears, then click on the OAuth link.");
	return "echosign fail";
  }
  else {
	Logger.log("uploadAgreement: we have echosignService hasAccess = true");
  }


  var sheetPassedIn = ! (sheet == undefined);

  if (! sheetPassedIn && SpreadsheetApp.getActiveSheet().getName() == "controller") {
	Logger.log("in controller mode, switching to uploadOtherAgreements()");
	uploadOtherAgreements_();
	return;
  }

  sheet = sheet || SpreadsheetApp.getActiveSheet();

  var ui = SpreadsheetApp.getUi();
  var response = ui.alert("Send to EchoSign?",
						  "Are you sure you want to send to EchoSign?\nThis feature is not working very well for exploded (one per investor) type documents.",
						  ui.ButtonSet.YES_NO);
  
  if (response == ui.Button.NO) return;
  
  var ss = sheet.getParent();
  var entitiesByName = {};
  var readRows = readRows_(sheet, entitiesByName);
  var terms    = readRows.terms;
  var config   = readRows.config;

  alertIfActiveSheetChanged_(sheet);

  // TODO: be more organized about this. in the same way that we generated one or more output PDFs for each input template
  // we now need to upload exactly that number of PDFs as transientdocuments, then we need to uploadAgreement once for each PDF.

  var suitables = suitableTemplates_(config);
  Logger.log("resolved suitables = %s", suitables.map(function(e){return e.url}).join(", "));
  for (var si in suitables) {
    var sourceTemplate = suitables[si];

	// THIS IS A HUGE BUG RIGHT NOW because we're deliberately ignoring the collation between transientDocumentIds and the suitabletemplates.
	// TODO: THINK THIS ALL THROUGH.

  var parties = templateParties(sheet, readRows, sourceTemplate);
  var transientDocumentIds = uploadPDFsToEchoSign_(sheet);
  var emailInfo = [];
  var cc_list = parties._allparties.filter(function(party){return party.legalese_status.toLowerCase()=="cc"}); // TODO: get rid of allparties. compute cc differently
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

  // TODO: handle explosion scenarios where each party gets a separate agreement.
  
  // update the party's Legalese Status cell to indicate we've sent the mail.
  
  for (var p in parties._unmailed) {
	var party = parties._unmailed[p];
	// if multi-address, then first address is To: and subsequent addresses are CC
	var to_cc = email_to_cc_(party.email);
	if (to_cc[0] != undefined) {
	  var _to_email = to_cc[0];
	  if (readRows.config.email_override) { entity._to_email = plusNum(p, readRows.config.email_override.values[0]); }

	  emailInfo.push({email:_to_email, role:"SIGNER"});
	  commit_updates_to.push(getPartyCells_(sheet, terms, party));
	}
	if (to_cc[1].length > 0) {
	  cc2_list = cc2_list.concat(to_cc[1]);
	}
  }
  if (readRows.config.email_override) { cc2_list = [readRows.config.email_override.values[0]]; }

  Logger.log("we shall be emailing to %s", emailInfo);

  if (emailInfo.length == 0) {
	SpreadsheetApp.getUi().alert("There doesn't seem to be anybody for us to mail this to! Check the Legalese Status column.");
	return "no recipients!";
  }

  // TODO: who shall we cc to? everybody whose legalese status == "cc".
  for (var p in cc_list) {
	var party = cc_list[p];
	commit_updates_cc.push(getPartyCells_(sheet, terms, party));
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

	if (config.skip_echosign && config.skip_echosign.values[0] == true) {
	  Logger.log("skipping the sending to echosign");
	}
	else {
	  Logger.log("actually posting to echosign");
	  var acr = postAgreement_(	{ "transientDocumentId": transientDocumentId },
								emailInfo,
								config.echosign.tree.message,
								config.echosign.tree.title,
								cc_list,
								terms,
								config,
								readmeDoc,
								null
							);
	}
	Logger.log("uploadAgreement: well, that seems to have worked!");
  }
}
  Logger.log("uploadAgreement: that's all, folks!");
  return "sent";
}

// ---------------------------------------------------------------------------------------------------------------- postAgreement_
function postAgreement_(fileInfos, recipients, message, name, cc_list, terms, config, readmeDoc, agreementCreationInfo) {
  var api = getEchoSignService_();

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

	// TODO: if the data.expiry_date is defined then add 24 hours to it and stick it in
	// but also set the configuration option that decides if we should honour it or not.
	if (config.echosign_expires != undefined && config.echosign_expires.values[0]
	   && terms.expiry_date != undefined) {
	  
	  var days_until = ((new Date(terms._orig_expiry_date)).getTime() - (new Date()).getTime()) / (24 * 60 * 60 * 1000);
	  Logger.log("expiry date is %s days in the future. will give an extra day for leeway", days_until);
	  agreementCreationInfo.daysUntilSigningDeadline = days_until + 1;
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

  
// ---------------------------------------------------------------------------------------------------------------- localization

function plural(num, singular, plural, locale) {
  if (locale == undefined) { locale = "en-US" }
  if (num.constructor.name == "Array") { num = num.length }
  if (locale == "en-US") {
	if (plural == undefined) { plural = singular + "s" }
	if (num  > 1) { return plural }
	if (num == 1) { return singular }
	if (num == 0) { return plural }
  }
}

function plural_verb(num, singular, plural, locale) {
  if (locale == undefined) { locale = "en-US" }
  if (num.constructor.name == "Array") { num = num.length }
  if (locale == "en-US") {
	if (plural == undefined) {
	  if (singular == "is") { plural = "are"; }
	  else                  { plural = singular.replace(/s$/,""); }
	}
	if (num  > 1) { return plural }
	if (num == 1) { return singular }
	if (num == 0) { return plural }
  }
}

// ---------------------------------------------------------------------------------------------------------------- commaAnd
function commaAnd(mylist, propertyName) {
  var actualList = mylist.map(function(e){return (propertyName ? e[propertyName] : e)});
  if      (actualList.length == 0) { return "" }
  else if (actualList.length == 1) { return actualList[0] }
  else if (actualList.length == 2) { return actualList.join(" and ") }
  else                             { return [actualList.splice(0,actualList.length-1).join(", "), actualList[actualList.length-1]].join(", and ") }
}

// ---------------------------------------------------------------------------------------------------------------- mylogger

// ---------------------------------------------------------------------------------------------------------------- mylogger
function mylogger(input) {
  Logger.log(input);
}
// TODO:
// data.parties._investor_plural
// how many parties are there in all of the investors? if there's only one investor and it's a natural person then the answer is 1.
// otherwise the answer is probably plural.
// used by the convertible_loan_waiver.


function onEdit(e){
  // Set a comment on the edited cell to indicate when it was changed.
  var range = e.range;
  var sheet = range.getSheet();
  Logger.log("onEdit trigger firing: "+ e.range.getA1Notation());
  if (range.getA1Notation() == "C2") { // selected Entity Group
	sheet.getRange("D2").setFontStyle("italic");
	sheet.getRange("D2").setValue("wait...");
	sheet.getRange("D2").setBackground('yellow');

	sheet.getRange("C4").setBackground('white');
	sheet.getRange("C4").setValue("");

	Logger.log("updated C2, so we need to set D2");
	var sectionRange = sectionRangeNamed(sheet,"Entity Groups");
	var myv = myVLookup_(sheet, range.getValue(), sectionRange[0], sectionRange[1], 2);
	Logger.log("myVLookup returned " + myv);
	setDataValidation(sheet, "D2", myv); 

	sheet.getRange("D2").setValue("");
	sheet.getRange("D2").setFontStyle("normal");
;	sheet.getRange("D2").activate();

	sheet.getRange("C3").setValue("");
	sheet.getRange("C3").setBackground('white');

	sheet.getRange("C2").setBackground('lightyellow');
  }
  if (range.getA1Notation() == "D2") { // selected Entity
	sheet.getRange("D2").setBackground('lightyellow');

	sheet.getRange("C4").setBackground('white');
	sheet.getRange("C4").setValue("");

	sheet.getRange("C3").setValue("");
	sheet.getRange("C3").setBackground('yellow');
	sheet.getRange("C3").activate();
  }
  if (range.getA1Notation() == "C3") { // selected Template
	sheet.getRange("C3").setBackground('lightyellow');
	sheet.getRange("C4").setFontStyle("italic");
	sheet.getRange("C4").setValue("processing...");
	sheet.getRange("C4").activate();
  }
}

function sectionRangeNamed(sheet, sectionName) {
  // the rows that have data, after the row where [0]=="SOURCES" && [1]==sectionName

  // manual runtesting from the web ui
  if (sheet == null) { sheet = SpreadsheetApp.getActiveSheet(); }
  if (sectionName == null) { sectionName = "Entity Groups" }

  var dataRange = sheet.getDataRange();
  var dataRangeValues = dataRange.getValues();

  var startRow;
  var endRow;
  var inRange = false;

  for (var i = 0; i < dataRangeValues.length; i++) {
	var row = dataRangeValues[i];
	if      (! inRange && row[0] == "SOURCES" && row[1] == sectionName) { startRow = i+2; inRange=true;  continue }
	else if (  inRange && row[0] == "SOURCES" && row[1] != sectionName) {                 inRange=false; break    }
	else if (  inRange &&                        row[1]               ) {   endRow = i+1;                         }
  }
  Logger.log("found section named "+sectionName+" from row " + startRow + " to " + endRow );
  return [startRow, endRow];
}

function myVLookup_(sheet, str, rowStart, rowEnd, colIndex) {
  // return the data range for the row in which str matches col
  Logger.log("myVLookup: starting with rowStart="+rowStart+", rowEnd="+rowEnd + ", colIndex="+colIndex);
  var searchRange = sheet.getRange(rowStart, colIndex, rowEnd-rowStart+1);
  Logger.log("myVLookup: searching range " + searchRange.getA1Notation());
  for (var i = 1; i <= searchRange.getNumRows(); i++) {
	Logger.log("myVLookup: considering row " + (rowStart + i - 1) + " whose getCell("+i+",1) value is " + searchRange.getCell(i, 1).getValue());
	if (searchRange.getCell(i, 1).getValue() == str) { var toreturn = sheet.getRange(rowStart + i - 1, 3, 1, sheet.getLastColumn()).getA1Notation();
													   // SpreadsheetApp.getUi().alert("found " + str + "; returning " + toreturn);
													   return toreturn;
													 }
  }
  SpreadsheetApp.getUi().alert("falling off the end");
  return null;
}


function setDataValidation(sheet, dest, source) {
 var destinationRange = sheet.getRange(dest);
 var sourceRange = sheet.getRange(source);
 var rule = SpreadsheetApp.newDataValidation().requireValueInRange(sourceRange).build();
 var rules = destinationRange.getDataValidations();
 for (var i = 0; i < rules.length; i++) {
   for (var j = 0; j < rules[i].length; j++) {
     rules[i][j] = rule;
   }
 }
 destinationRange.setDataValidations(rules);
}


function partiesWearingManyHats(data, principal, hats) {
  var candidates = {};
  for (var hi in hats) {
	var role = hats[hi];
	for (var ei in principal.roles[role]) {
	  var entity = principal.roles[role][ei];
	  Logger.log("partiesWearingManyHats: entity %s wears the %s hat",
				 entity, role);
	  candidates[entity] = candidates[entity] || 0;
	  candidates[entity]++;
	}
  }
  var toreturn = [];
  for (var ci in candidates) {
	if (candidates[ci] == hats.length) { toreturn.push(data._entitiesByName[ci]) }
  }
  Logger.log("returning %s", toreturn);
  return toreturn;
}
