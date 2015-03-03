// import an XML file into the Legalese template.
// this runs as an Adobe InDesign script.

#include "xml2pdf-lib.jsx"

main();
// -------------------------------------------------- main
function main(){

  var interactive = true;

  var xmlFiles = identifyXmlFiles("recurse",  // recurse | queryUser
								  Folder("~/Google Drive/Legalese Root"));
  var indtFile = identifyIndtFile("hardcoded", // hardcoded | queryUser
								  "~/non-db-src/legalese/build/00 legalese template.indt");

  if (interactive && xmlFiles.length == 0) { alert ("nothing to do. Is Google Drive synced?"); } 

  if (xmlFiles.length > 0) {
	app.scriptPreferences.enableRedraw=true; 
	xmls2pdf(xmlFiles, indtFile, interactive);
	app.scriptPreferences.enableRedraw=true;
  }
}

