"use strict";

const crypto = require("crypto");
const uuidv4 = require("uuid/v4");
const mozlog = require("../log");
const log = mozlog("controllers.utils");

const AppConstants = require("../app-constants");


function generatePageToken(req) {
  const pageToken = {ip: req.ip, date: new Date(), nonce: uuidv4()};
  const cipher = crypto.createCipher("aes-256-cbc", AppConstants.COOKIE_SECRET);
  const encryptedPageToken = [cipher.update(JSON.stringify(pageToken), "utf8", "base64"), cipher.final("base64")].join("");
  return encryptedPageToken;

  /* TODO: block on scans-per-ip instead of scans-per-timespan
  if (req.session.scans === undefined){
    console.log("session scans undefined");
    req.session.scans = [];
  }
  req.session.numScans = req.session.scans.length;
  */
}

function hasUserSignedUpForRelay(user) {
  if (!user.waitlists_joined) {
    return false;
  }
  if (user.waitlists_joined.hasOwnProperty("email_relay")) {
    return true;
  }
  return false;
}

function chooseVariation(variations, sorterNum){

  let totalPercentage = 0;

  // calculate and store total percentage of variations
  for (const v in variations) {
    if (variations.hasOwnProperty(v) && typeof variations[v] === "number") {
      // multiply by 100 to allow for percentages to the hundredth
      // (and avoid floating point math errors)
      totalPercentage += (variations[v] * 100);
    }
  }

  totalPercentage = totalPercentage / 100;

  // Make sure totalPercent is between 0 and 100
  if (totalPercentage === 0 || totalPercentage > 100) {
    throw new Error(`The total percentage ${totalPercentage} is out of bounds!`);
  }

  // make sure random number falls in the distribution range
  let runningTotal;
  let choice;

  if (sorterNum <= totalPercentage) {
      runningTotal = 0;

      // loop through all variations
      for (const v in variations) {
          // check if random number falls within current variation range
          if (sorterNum <= (variations[v] + runningTotal)) {
              // if so, we have found our variation
              choice = v;
              break;
          }

          // tally variation percentages for the next loop iteration
          runningTotal += variations[v];
      }
    }

    return choice;

}

function unEnrollSession(session) {
  session.excludeFromExperiment = true;
  session.experimentBranch = false;
  session.treatmentBranch = false;
}

function getExperimentBranch(req, sorterNum = false, language = false, variations) {

  const sessionExperimentFlags = req.session.experimentFlags;

  if (sessionExperimentFlags.excludeFromExperiment && !req.query.experimentBranch) {
    log.debug("This session has already been excluded from the experiment");
    unEnrollSession(sessionExperimentFlags);
    return false;
  }

  // If we cannot parse req.headers["accept-language"], we should not
  // enroll users in the experiment.
  if (language && !req.headers || language && !req.headers["accept-language"]){
    log.debug("No headers or accept-language information present.");
    unEnrollSession(sessionExperimentFlags);
    return false;
  }

  // If the user doesn't have the requested variant langauge selected as their primary language,
  // we do not enroll them in the experiment.
  if (language) {

    if (!Array.isArray(language)) {
      throw new Error("The language param is not an array");
    }
    const lang = req.headers["accept-language"].split(",");

    // Check to make sure one of the experiment langauge(s) is the top-preferred language.
    const firstLangMatch = (element) => lang[0].includes(element);
    if (language && !language.some(firstLangMatch)) {
      log.debug(`Preferred language is not [${language}] variant: ${lang[0]}`);
      unEnrollSession(sessionExperimentFlags);
      return false;
    }
  }

  // If URL param has experimentBranch entry, use that branch;
  if (req.query.experimentBranch) {
    if (!Object.keys(variations).includes(req.query.experimentBranch)) {
      log.debug("The requested branch is unknown: ", req.query.experimentBranch);
      unEnrollSession(sessionExperimentFlags);
      return false;
    }
    log.debug("This session has been set to the requested branch: ", req.query.experimentBranch);
    sessionExperimentFlags.excludeFromExperiment = false;
    sessionExperimentFlags.experimentBranch = req.query.experimentBranch;
    return req.query.experimentBranch;
  }

  // If user was already assigned a branch, stay in that branch;
  if (sessionExperimentFlags.experimentBranch) {
    log.debug("This session has already been assigned: ", sessionExperimentFlags.experimentBranch);
    return sessionExperimentFlags.experimentBranch;
  }

  if (sorterNum === false) {
    sorterNum = Math.floor(Math.random() * 10000) + 1;
    sorterNum = sorterNum/100;
    // sorterNum = Math.floor(Math.random() * 100);
    log.debug("No coinflip number provided. Coinflip number is ", sorterNum);
  } else {
    log.debug("Coinflip number provided. Coinflip number is ", sorterNum);
  }

  const assignedCohort = chooseVariation(variations, sorterNum);

  if (!assignedCohort) {
    log.debug("This session has randomly been removed from the experiment");
    sessionExperimentFlags.excludeFromExperiment = true;
    return false;
  }

  log.debug(`This session has been randomly assigned to the ${assignedCohort} cohort.`);
  sessionExperimentFlags.experimentBranch = assignedCohort;
  if (assignedCohort === "vb") { sessionExperimentFlags.treatmentBranch = true; }
  return assignedCohort;

}

function getExperimentFlags(req, EXPERIMENTS_ENABLED) {
  if (!req) {
    throw new Error("No request availabe");
  }

  if (req.session.experimentFlags && EXPERIMENTS_ENABLED) {
    return req.session.experimentFlags;
  }

  const experimentFlags = {
    experimentBranch: false,
    treatmentBranch: false,
    excludeFromExperiment: false,
  };

  req.session.experimentFlags = experimentFlags;
  return experimentFlags;
}


module.exports = {
  generatePageToken,
  hasUserSignedUpForRelay,
  getExperimentBranch,
  getExperimentFlags,
};
