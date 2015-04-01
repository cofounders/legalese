// import an XML file into the Legalese template.
// this runs as an Adobe InDesign script.

#include "xml2pdf-lib.jsx"

main();
// -------------------------------------------------- main
function main(){

  var interactive = true;

  var saveIndd = false;
  
  var xmlFiles = identifyXmlFiles("recurse",  // recurse | queryUser
								  Folder("~/Google Drive/Legalese Root"));
  
  if (interactive && xmlFiles.length == 0) { alert ("nothing to do. Is Google Drive synced?"); } 

  if (xmlFiles.length > 0) {
	app.scriptPreferences.enableRedraw=true; 
	xmls2pdf(xmlFiles, interactive, saveIndd);
	app.scriptPreferences.enableRedraw=true;
  }
}

