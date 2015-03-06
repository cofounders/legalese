// library used by
// xml2pdf      -- the interactive runtime
// xml2pdf-idle -- the idle task launched once which continuously monitors the Legalese Incoming folder
//
// mengwong@legalese.io mengwong@jfdi.asia 20150104

#include "/Applications/Adobe InDesign CC/Scripts/XML Rules/glue code.jsx"

// -------------------------------------------------- xmls2pdf
function xmls2pdf(xmlFiles, showingWindow) {
  if (showingWindow == undefined) showingWindow = false;
  var errors = [];
  app.textPreferences.smartTextReflow = false;
  for (var i in xmlFiles) {
	var xmlFile = xmlFiles[i];
	try {
	  logToFile("xmls2pdf: starting " + xmlFile.fullName);

	  // maybe each xmlFile can specify its desired indt template filename?
	  var indtFile = identifyIndtFile("fromXML", // fromXML | hardcoded | queryUser
									  "~/non-db-src/legalese/build/00 legalese template.indt",
									  xmlFile
									 );

	  var doc = importXmlIntoTemplate(xmlFile, indtFile, showingWindow);
	  doc.textPreferences.smartTextReflow = false;
//	  doc.textPreferences.limitToMasterTextFrames = false;
//	  doc.textPreferences.deleteEmptyPages = true;

	  doc.recompose(); // force smart text reflow otherwise the signature fields won't add properly.
	  addCrossReferences(doc);
	  logToFile("xmls2pdf: about to constructFormFields. page length is " + doc.pages.length);
	  constructFormFields(doc);
	  // findAndReplace(doc); change " to ''
	  // trim trailing newlines from the document. not quite sure how to do this.
	  doc.recompose();
	  logToFile("xmls2pdf: about to exportToPDF");
	  exportToPDF(doc, xmlFile);
	  logToFile("xmls2pdf: about to saveAsIndd, for the second time");
	  saveAsIndd(doc, xmlFile);
	  if (! showingWindow) doc.close()
	  else doc.pages.item(-1).textFrames.item(0).select();
	  logToFile("xmls2pdf: finished " + xmlFile.fullName);
	}
	catch (error) {
	  saveFail(xmlFile, error);
	  errors.push(xmlFile.fullName + ": " + error);
	}
  }
  if (showingWindow && errors.length > 0) { alert (errors) }
}

// -------------------------------------------------- addCrossReferences
// i don't know how to do this. maybe we will need to
// convert the XML into IDML.
function addCrossReferences(doc) {
}


// -------------------------------------------------- isXmlOrFolder
function isXmlOrFolder(file) {
  return (file.constructor.name == "Folder"
		  || file.name.match(/\.xml$/));
}

// -------------------------------------------------- findXmls
function findXmls(folder) {
  var toreturn = [];
  var candidates = folder.getFiles(isXmlOrFolder);
  for (var i in candidates) {
	if (candidates[i].constructor.name == "File") {
	  toreturn.push(candidates[i]);
	}
	else {
	  var moreFiles = findXmls(candidates[i]);
	  for (var j in moreFiles) {
		toreturn.push(moreFiles[j]);
	  }
	}
  }
  return toreturn;
}

// -------------------------------------------------- identifyXmlFiles
function identifyXmlFiles(mode, rootFolder) {
  var xmlFiles = [];
  if (mode == "recurse") {
	// the idle task will monitor the incoming folder for XML files
	var todo = findXmls(rootFolder);
	for (var i in todo) {
	  var xmlFile = todo[i];
	  if (hasPDF(xmlFile) || hasFail(xmlFile)) { continue; }
	  else { xmlFiles.push(xmlFile); }
	}
  }
  else if (mode == "queryUser"
		  || mode == undefined) {
	xmlFiles = File.openDialog(
	  "Choose one or more source XML files to place into the Legalese template",
	  isXmlOrFolder,
	  true); // multiselect
  }
  return xmlFiles;
}

// -------------------------------------------------- identifyIndtFile
function identifyIndtFile(mode, path, xmlFile) {
  var indtFile;
  if (mode == "fromXML") {
	xmlFile.open("r");
	var myXML = new XML(xmlFile.read());
	xmlFile.close();

	var templateSpec = myXML.attribute("templateSpec");
	if (templateSpec != undefined) {
	  if (templateSpec == "singlepage.indt") {
		path = "~/non-db-src/legalese/build/" + templateSpec;
		mode = "hardcoded";
	  }
	  else {
		mode = "queryUser";
	  }
	}
	else {
	  if (path.length)	mode = "hardcoded";
	  else				mode = "queryUser";
	} 
  }
  // not an else if because we cascade from above
  if (mode == "hardcoded") {
	indtFile = new File(path);
	if (indtFile.exists) return indtFile else mode = "queryUser";
  } 
  // not an else if because we cascade from above
  if (mode == "queryUser"
	  || mode == undefined
	 ) {
	indtFile = File.openDialog(
	  "Choose the Legalese template",
	  function(file) {
		return (file.constructor.name == "Folder"
				|| file.name.match(/\.indt$/));
	  },
	  false); // multiselect
  }
  return indtFile;
}

// -------------------------------------------------- importXmlIntoTemplate
function importXmlIntoTemplate(xmlFile, indtFile, showingWindow) {
  // here goes Chapter 12 of the Indesign Scripting Guide for JavaScript

  // iterate through each element. if its tag corresponds to a paragraph style (as opposed to a character style) then append a trailing newline unless the element already has one.

  var doc = app.open(indtFile, showingWindow);
  var importMaps = {};
  for (var i = 0; i < doc.xmlImportMaps.length; i++) {
	importMaps[doc.xmlImportMaps.item(i).markupTag.name] = doc.xmlImportMaps.item(i).mappedStyle;
  }

  doc.xmlElements.item(0).importXML(xmlFile);

  __processRuleSet(doc.xmlElements.item(0), [new AddReturns(doc,importMaps),
											 new InsertTextVariables(doc,importMaps)
											]);
//  alert("processRuleSet AddReturns completed successfully");

  doc.mapXMLTagsToStyles();


  // findReplaceFixes
  findReplaceFixes(doc, doc.stories);

  doc.stories.everyItem().recompose();

  __processRuleSet(doc.xmlElements.item(0), [new RestartParagraphNumbering(doc,importMaps)
											]);

  return doc;
}



// -------------------------------------------------- AddReturns
function AddReturns(doc, importMaps){
  this.name = "AddReturns";
  this.xpath = "//*";
  this.apply = function(myElement, myRuleProcessor){

	if ((myElement.xmlAttributes.item("addnewline").isValid &&
		 myElement.xmlAttributes.item("addnewline").value == "true")
		|| (importMaps[myElement.markupTag.name] != undefined
			&& importMaps[myElement.markupTag.name].constructor.name == "ParagraphStyle"
			&& importMaps[myElement.markupTag.name].name != "[Basic Paragraph]"
			&& myElement.markupTag.name != "Table"
			&& myElement.markupTag.name != "Cell"
			&& ! myElement.markupTag.name.match(/^cell/i)
			&& (! myElement.xmlAttributes.item("addnewline").isValid ||
				myElement.xmlAttributes.item("addnewline").value != "false")
			&& ! myElement.contents.match(/\r$/)
		   )
	   ) {
	  logToFile("appending newline to element " + myElement.markupTag.name);
      myElement.insertTextAsContent("\r", XMLElementPosition.ELEMENT_END);
	}
    return false;
  }
}

// -------------------------------------------------- findReplaceFixes
function findReplaceFixes(doc, stories) { 
    //Clear the find/change text preferences.
    app.findTextPreferences = NothingEnum.nothing;
    app.changeTextPreferences = NothingEnum.nothing;

    //Set the find options.
    app.findChangeTextOptions.caseSensitive = false;
    app.findChangeTextOptions.includeFootnotes = false;
    app.findChangeTextOptions.includeHiddenLayers = false;
    app.findChangeTextOptions.includeLockedLayersForFind = false;
    app.findChangeTextOptions.includeLockedStoriesForFind = false;
    app.findChangeTextOptions.includeMasterPages = false;
    app.findChangeTextOptions.wholeWord = false;

    // equivalent to the preset that replaces dumb doublequotes with smart doublequotes
    app.findTextPreferences.findWhat = '^"';
    app.changeTextPreferences.changeTo = '"';
    stories.everyItem().changeText();

    // equivalent to the preset that replaces dumb singlequotes with smart singlequotes
    app.findTextPreferences.findWhat = '^\'';
    app.changeTextPreferences.changeTo = '\'';
    stories.everyItem().changeText();

    // replace triple dashes with single emdash
    app.findTextPreferences.findWhat = '---';
    app.changeTextPreferences.changeTo = '^_';
    stories.everyItem().changeText();

    // equivalent to the preset that replaces a double dash with a single endash
    app.findTextPreferences.findWhat = '--';
    app.changeTextPreferences.changeTo = '^=';
    stories.everyItem().changeText();

    //Clear the find/change text preferences after the search.
    app.findTextPreferences = NothingEnum.nothing;
    app.changeTextPreferences = NothingEnum.nothing;
}


// -------------------------------------------------- InsertTextVariables
function InsertTextVariables(doc, importMaps){
  this.name = "InsertTextVariables";
  this.xpath = "//textvar";	
  this.apply = function(myElement, myRuleProcessor){
	var myInsertionPoint = myElement.insertionPoints.item(0);
	var textVariableInstance = myInsertionPoint.textVariableInstances.add({associatedTextVariable: doc.textVariables.item( myElement.xmlAttributes.item("name").value ) });
    return false;
  }
}

// TODO: look for a restart=true attribute and tell the paragraph bullet & numbering to restart.
// -------------------------------------------------- AddReturns
function RestartParagraphNumbering(doc, importMaps){
  this.name = "RestartParagraphNumbering";
  this.xpath = "//*[@restart='true']";
  this.apply = function(myElement, myRuleProcessor){

	myElement.paragraphs.item(0).numberingContinue = false;

    return false;
  }
}


function myGetBounds(myDocument, myPage){
	var myPageWidth = myDocument.documentPreferences.pageWidth;
	var myPageHeight = myDocument.documentPreferences.pageHeight
	if(myPage.side == PageSideOptions.leftHand){
		var myX2 = myPage.marginPreferences.left;
		var myX1 = myPage.marginPreferences.right;
	}
	else{
		var myX1 = myPage.marginPreferences.left;
		var myX2 = myPage.marginPreferences.right;
	}
	var myY1 = myPage.marginPreferences.top;
	var myX2 = myPageWidth - myX2;
	var myY2 = myPageHeight - myPage.marginPreferences.bottom;
	return [myY1, myX1, myY2, myX2];
}


// -------------------------------------------------- constructFormFields
function constructFormFields(doc) {
//  alert("constructFormFields running");

  // for each signature table in the signaturs page,
  // create a new textframe adjacent to the signature table, anchored,
  // and set the name of the field to be something that echosign will respect --
  // in other words, <sometext>_es_signer<n>_signature

  doc.viewPreferences.horizontalMeasurementUnits = MeasurementUnits.points;
  doc.viewPreferences.verticalMeasurementUnits = MeasurementUnits.points;

  // if smart text reflow has not completed,
  // then the signaturepage is in the overset region, and adding an anchored object
  // is eventually going to barf when we try to do anything with geometricbounds.

  // so we kludge by adding a last page to the document
  // we add a text frame to that page
  // and we manually thread the text frame
  // https://forums.adobe.com/thread/1675713	
  if (true) {
	
	doc.textPreferences.smartTextReflow = false;
	//doc.textPreferences.limitToMasterTextFrames = false;
	//doc.textPreferences.deleteEmptyPages = false;
	//doc.textPreferences.addPages = AddPageOptions.END_OF_DOCUMENT;

	var lastpage = doc.pages.item(-1);
	var lasttextframe = lastpage.textFrames.item(-1);
	logToFile("the lastpage is " + lastpage.name);
	logToFile("the last textframe is " + lasttextframe.name);

	doc.recompose();
	logToFile("the lastpage is " + lastpage.name);

	var pages_to_add = 10;
	var new_pages = [];

	logToFile("creating " + pages_to_add + " pages because smart text reflow page addition doesn't run right under scripting and creates invalid object errors when i try to create an anchored signature box.");
	for (var i = 0; i < pages_to_add; i++) {
	  var np = doc.pages.add();
	  var np_textframe = np.textFrames.add({geometricBounds: myGetBounds(doc, np)});
	  new_pages[i] = np;
	  if (i > 0 && (i < pages_to_add-1)) { new_pages[i-1].textFrames.item(0).nextTextFrame = new_pages[i].textFrames.item(0); }
	}

	lasttextframe.nextTextFrame = new_pages[0].textFrames.item(0);

	logToFile("against all odds, that succeeded");
  }

  doc.recompose();

  logToFile("about to processRuleSet AddFormFields");
  __processRuleSet(doc.xmlElements.item(0), [new AddFormFields(doc)
											]);

  logToFile("processRuleSet AddFormFields completed successfully. removing last page.");
  // now we get rid of the excess pages.
	doc.textPreferences.smartTextReflow = true;
	doc.textPreferences.limitToMasterTextFrames = false;
	doc.textPreferences.deleteEmptyPages = true;

  // trigger smart text reflow by adding a new textframe.

  logToFile("trigger reflow by linking last text frames");
  var lasttextframe = doc.pages.item(-2).textFrames.item(0);
  var  newtextframe = doc.pages.item(-1).textFrames.item(0);
  logToFile("attaching text frames");
  lasttextframe.nextTextFrame = newtextframe;
  logToFile("new text frame added.");

	var myProfile = app.preflightProfiles.item(0);
	var myProcess = app.preflightProcesses.add(doc, myProfile);
	logToFile("giving time for smart text reflow");
	myProcess.waitForProcess(20);
	myProcess.remove();
//	alert("giving time for smart text reflow. page length is " + doc.pages.length);

//  np.remove();
  doc.recompose();

}


// -------------------------------------------------- addFormFields
function AddFormFields(doc) {
  this.name = "AddFormFields";
  this.xpath = "//table_enclosing_para[@class='signatureblock' and @unmailed='true']";
  this.apply = function(el, myRuleProcessor){

	var myInsertionPoint = el.paragraphs.item(0).insertionPoints.item(2);

	var signatureField = myInsertionPoint.signatureFields.add();
	logToFile("created signatureField. setting anchored object settings. " +signatureField );

	with(signatureField.anchoredObjectSettings){
	  pinPosition = false;
	  anchoredPosition = AnchorPosition.anchored;
	  anchorPoint = AnchorPoint.topLeftAnchor;
	  horizontalReferencePoint = AnchoredRelativeTo.anchorLocation;
	  horizontalAlignment = HorizontalAlignment.leftAlign;
	  anchorXoffset = -160; // this needs to match the template's columnWidth
	  verticalReferencePoint = VerticallyRelativeTo.lineBaseline;
	  anchorYoffset = 0;
	  anchorSpaceAbove = 0;
	}

	// maybe preflighting will give the system time for a recompose?
	doc.recompose();

	logToFile("will i die?");
	signatureField.geometricBounds = [0,0,55,216];
	logToFile("probably died.");

	// https://secure.echosign.com/doc/TextFormsTutorial.pdf
	// http://bgsfin.com/Add-Ons/SmartFormsTutorial.pdf

	if (el.xmlAttributes.item("unmailed").isValid) {
	  logToFile("el.xmlAttributes.item(unmailed) = " + el.xmlAttributes.item("unmailed").value);
	  
	  if (el.xmlAttributes.item("unmailed").value == "true") {
		var signatureCount = el.xmlAttributes.item("esnum").value;
		logToFile("setting signature field name to " + "legalese_es_signer" + signatureCount + "_signature");
		signatureField.name = "legalese_es_signer" + signatureCount + "_signature";
	  }
	}
	
	doc.recompose();

	return false;
  }
}

// -------------------------------------------------- exportToPDF
function exportToPDF(doc, xmlFile) {
  var pdfPath = xmlFile.fsName.replace(/\.xml$/, ".pdf");
  with(app.interactivePDFExportPreferences){
	viewPDF = false;
  }
  doc.exportFile(ExportFormat.interactivePDF,
				 new File(pdfPath),
				 false);
}

// -------------------------------------------------- saveAsINDD
function saveAsIndd(doc, xmlFile) {
  var inddPath = xmlFile.fsName.replace(/\.xml$/, ".indd");
  doc.save(new File(inddPath));
}

// -------------------------------------------------- saveFail
function saveFail(xmlFile, contents) {
  var failPath = xmlFile.fsName.replace(/\.xml$/, ".fail");
  var file = new File(failPath);
  file.open("a");
  file.writeln(contents);
  file.close();
}

// -------------------------------------------------- hasPDF
function hasPDF(xmlFile) {
  var pdfPath = xmlFile.fsName.replace(/\.xml$/, ".pdf");
  return (new File(pdfPath)).exists;
}

// -------------------------------------------------- hasFail
function hasFail(xmlFile) {
  var failPath = xmlFile.fsName.replace(/\.xml$/, ".fail");
  return (new File(failPath)).exists;
}

// -------------------------------------------------- logToFile
function logToFile(message) {
  var logfile = new File("~/non-db-src/legalese/build/indesignlog.txt");
  logfile.open("a");
  logfile.writeln((new Date()) + "\t" + message);
  logfile.close();
}

