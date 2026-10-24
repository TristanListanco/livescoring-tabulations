/**
 * Tabulous user survey, built on UTAUT2 (Venkatesh, Thong & Xu, 2012). Creates the Google Form and a Google Sheet for
 * its responses, then logs the link to share.
 *
 * Run it once: open https://script.new while signed in to the Google account that should own the form, replace the
 * code with this file, press Run (createSurvey), allow access when Google asks, and open View > Logs (or the
 * Execution log) for the links. Running it again makes a second form.
 *
 * Constructs and items (7-point scale, 1 = strongly disagree, 7 = strongly agree), adapted to Tabulous:
 *   PE  Performance expectancy   PE1–PE4
 *   EE  Effort expectancy        EE1–EE4
 *   SI  Social influence         SI1–SI3
 *   FC  Facilitating conditions  FC1–FC4
 *   HM  Hedonic motivation       HM1–HM3
 *   PV  Price value              PV1–PV3  (Tabulous is free: adapted to value for time and effort)
 *   HT  Habit                    HT1–HT4  (HT2 adapted from "addicted" to "rely on")
 *   BI  Behavioral intention     BI1–BI3
 *   UB  Use behavior             the number of events used (About you)
 * Moderators (UTAUT2's age, gender and experience), the respondent's role and device are in About you. Each statement
 * comes out in the Sheet as a column "<grid title> [<statement>]", in the order listed here: CONSTRUCTS below is the
 * codebook, mapping each grid title to its construct. The app links the form from src/lib/survey.ts.
 */
const SURVEY = {
  title: "Tabulous user survey",
  researcher: "Tristan Listanco",
  contact: "tristan.listanco@g.msuiit.edu.ph",
};

const SCALE = ["1 Strongly disagree", "2", "3", "4 Neither agree nor disagree", "5", "6", "7 Strongly agree"];

const CONSTRUCTS = [
  {
    code: "PE",
    title: "How useful Tabulous is",
    items: [
      "Tabulous is useful for judging, running or following a judged event.",
      "Using Tabulous helps me get the results I need more quickly.",
      "Using Tabulous helps me achieve what matters to me at an event, such as fair and accurate results.",
      "Using Tabulous makes me more productive during an event.",
    ],
  },
  {
    code: "EE",
    title: "How easy Tabulous is",
    items: [
      "Learning how to use Tabulous was easy for me.",
      "My interaction with Tabulous is clear and understandable.",
      "I find Tabulous easy to use.",
      "It is easy for me to become skillful at using Tabulous.",
    ],
  },
  {
    code: "SI",
    title: "The people around you",
    items: [
      "People who are important to me think I should use Tabulous.",
      "People who influence my behavior think I should use Tabulous.",
      "People whose opinions I value prefer that I use Tabulous.",
    ],
  },
  {
    code: "FC",
    title: "What you have to use it",
    items: [
      "I have the resources I need to use Tabulous, such as a device and a connection.",
      "I have the knowledge I need to use Tabulous.",
      "Tabulous works with the other technologies I use.",
      "I can get help from others when I have difficulty using Tabulous.",
    ],
  },
  {
    code: "HM",
    title: "How it feels to use",
    items: ["Using Tabulous is fun.", "Using Tabulous is enjoyable.", "Using Tabulous is entertaining."],
  },
  {
    code: "PV",
    title: "Value for your time and effort",
    help: "Tabulous is free to use, so these ask about value for the time and effort it takes.",
    items: [
      "Tabulous is worth the time and effort it takes to use.",
      "Compared with paper score sheets and spreadsheets, Tabulous is good value.",
      "For what it takes to set up and use, Tabulous provides good value.",
    ],
  },
  {
    code: "HT",
    title: "Habit",
    items: [
      "Using Tabulous at judged events has become a habit for me.",
      "I rely on Tabulous for judged events.",
      "I feel I must use Tabulous at judged events.",
      "Using Tabulous at judged events has become natural to me.",
    ],
  },
  {
    code: "BI",
    title: "Using it again",
    items: [
      "I intend to keep using Tabulous at future judged events.",
      "I will always try to use Tabulous at judged events.",
      "I plan to use Tabulous often at judged events.",
    ],
  },
];

function createSurvey() {
  const form = FormApp.create(SURVEY.title);
  form
    .setDescription(
      [
        "This survey asks how you found Tabulous, the scoring system used at your event. Your answers help improve it, " +
          "and are used in research on how people accept and use event tabulation technology, based on the UTAUT2 model. " +
          "It takes about 8 minutes.",
        "",
        "• Taking part is voluntary. You can stop at any time before you submit, and the open questions at the end are optional.",
        "• It's anonymous: the form doesn't collect your name or email address. Please don't write anything in your answers " +
          "that identifies you or anyone else.",
        "• Your answers are kept in Google Forms and Google Sheets, seen only by the researcher, reported only as group " +
          "results, and deleted when the study ends.",
        "• You must be 18 or older to take part.",
        "",
        `Researcher: ${SURVEY.researcher}, ${SURVEY.contact}. Under the Data Privacy Act of 2012 you can ask about your ` +
          "answers, or complain to the National Privacy Commission.",
      ].join("\n"),
    )
    .setCollectEmail(false)
    .setLimitOneResponsePerUser(false)
    .setAllowResponseEdits(false)
    .setShowLinkToRespondAgain(false)
    .setProgressBar(true)
    .setConfirmationMessage("Thank you. Your answers help make Tabulous better.");
  // A form made in a Google Workspace account (such as a university's) only takes answers from that organization's
  // accounts unless told otherwise: judges, organizers and audiences come from anywhere. Consumer accounts don't have
  // the setting, and throw.
  try {
    form.setRequireLogin(false);
  } catch (e) {
    Logger.log(`Couldn't open the form to everyone (${e}): check Settings > Responses.`);
  }

  // Consent first: "No" ends the form there.
  const consent = form
    .addMultipleChoiceItem()
    .setTitle("Do you agree to take part?")
    .setHelpText("You've read the information above, you're 18 or older, and you agree to your anonymous answers being used as described.")
    .setRequired(true);

  const about = form.addPageBreakItem().setTitle("About you");
  consent.setChoices([
    consent.createChoice("Yes, I agree to take part", about),
    consent.createChoice("No, I don't want to take part", FormApp.PageNavigationType.SUBMIT),
  ]);

  form
    .addCheckboxItem()
    .setTitle("How did you use Tabulous?")
    .setHelpText("Choose all that apply.")
    .setChoiceValues(["As a judge", "As the chair of the judges", "As an organizer", "Watching the live results or the LED wall"])
    .showOtherOption(true)
    .setRequired(true);
  form
    .addMultipleChoiceItem()
    .setTitle("How many events have you used Tabulous for, including this one?")
    .setChoiceValues(["1", "2 to 3", "4 to 5", "6 or more"])
    .setRequired(true);
  form
    .addMultipleChoiceItem()
    .setTitle("Before Tabulous, how were scores added up at the events you took part in?")
    .setChoiceValues(["Paper score sheets and a calculator", "Paper score sheets and a spreadsheet (such as Excel)", "Another tabulation app or website", "This was my first judged event"])
    .showOtherOption(true)
    .setRequired(true);
  form
    .addMultipleChoiceItem()
    .setTitle("Which device did you mostly use it on?")
    .setChoiceValues(["Phone", "Tablet", "Laptop or desktop computer"])
    .setRequired(true);
  form
    .addMultipleChoiceItem()
    .setTitle("Your age")
    .setChoiceValues(["18 to 24", "25 to 34", "35 to 44", "45 to 54", "55 or older"])
    .setRequired(true);
  form
    .addMultipleChoiceItem()
    .setTitle("Your gender")
    .setChoiceValues(["Female", "Male", "Prefer not to say"])
    .showOtherOption(true)
    .setRequired(true);

  form
    .addPageBreakItem()
    .setTitle("Your experience with Tabulous")
    .setHelpText("How much do you agree with each statement? 1 is strongly disagree, 7 is strongly agree. There are no right or wrong answers.");
  for (const construct of CONSTRUCTS) {
    const grid = form.addGridItem().setTitle(construct.title).setRows(construct.items).setColumns(SCALE).setRequired(true);
    if (construct.help) grid.setHelpText(construct.help);
  }

  form.addPageBreakItem().setTitle("Your feedback").setHelpText("Optional. Anything you tell us here helps decide what to improve next.");
  for (const question of [
    "What did you like most about Tabulous?",
    "What was hard, confusing or slow?",
    "Did anything go wrong while you used it? What happened?",
    "What should we add or improve?",
  ]) {
    form.addParagraphTextItem().setTitle(question);
  }

  const responses = SpreadsheetApp.create(`${SURVEY.title} responses`);
  form.setDestination(FormApp.DestinationType.SPREADSHEET, responses.getId());

  const link = form.shortenFormUrl(form.getPublishedUrl());
  Logger.log(`Share this link: ${link}`);
  Logger.log(`Edit the form: ${form.getEditUrl()}`);
  Logger.log(`Responses sheet: ${responses.getUrl()}`);
}
