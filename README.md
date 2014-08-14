legalese
========

Legalese 2.0 is what happens when software eats law – starting with contracts – starting with term sheets.

# Legalese 2.0

Experiments in the domain of Legalese 2.0, next-generation contracts, contract visualization, etc.

<http://legal.cf.sg>

## Use Cases

### Startup raises external financing

#### Startup wants to present a term sheet to an external investor

### Angel investor wants to lead a deal

### Startup needs an NDA

### Startup needs an employment agreement

## Feature Wishlist / High-Level Components

### Decompiler

### Negotiator

### Scenario Explorer

### Visualizer

### Prover

### Domain Specific Language

Inspirations include:
* LISP
* m4
* Moustache / Handlebars

What would a BNF for term sheets look like?

### Compiler

We need support for intelligent syntax.

#### Example

Suppose a convertible note usually specifies an interest percentage.

So a lot of the syntax is like "... shall repay the principal and accrued interest".

But what if they agree to a zero-coupon note? We could awkwardly say "The Borrower shall pay an interest rate of 0%" and let the text stand.

That's ugly, though. It's like text that says "The Borrower(s) shall pay the Lender(s)".

Let's smarten it up. It would be better to intelligently reduce all zero-coupon notes to just say "shall repay the principal".

One way to do that is with a macro: _PRINCIPALandINTEREST_ could be a macro that expands to the correct expression depending on the interest defined elsewhere.

So we can do this kind of thing in Lisp and we can do it in Javascript.



## Branding

### Project Title

Legalese 2.0

## Onboarding and Learning Curve

### How do people discover Legalese 2.0?

### Backward Compatibility

The closest things to free, standardized legals -- actually adopted by the startup community -- might be the standard docs offered by Y Combinator, TechStars, Series Seed, and other parties.

http://www.startupcompanylawyer.com/2010/03/14/how-do-the-sample-series-seed-financing-documents-differ-from-typical-series-a-financing-documents/

http://avc.com/2010/03/standardized-venture-funding-docs/

"The nice thing about standards is that you have so many to choose from."

It would be cool if our project could easily output each one of those flavours, just by making a single configuration change; think of how you can Save As a PDF, a Word Doc, as HTML, as RTF, as Pages. Of course there are semantic differences but the idea is to factor out the commonalities.

![XKCD 927](http://imgs.xkcd.com/comics/standards.png "XKCD: Standards")

What would encourage the "installed base", the legacy users, to adopt Legalese 2.0? Some kind of openness, allowing users to contribute, edit, fork, etc, their preferred "distribution" of documents. We can do this without opensourcing the entire project.

## Customer Segments

## Early Adopters

## Existing Alternatives

## Inspirations

## Research Notes

http://www.theenterprisearchitect.eu/blog/2009/05/06/dsl-development-7-recommendations-for-domain-specific-language-design-based-on-domain-driven-design/

legal.cf.sg

Helena Haapio, Next Generation Contracts

## Market Insight / Motivating Trend -- the Democratization of Early Stage Investing

The increasing capital efficiency of software startups and the democratization of early stage investing through crowdfunding and angelist have brought a new wave of first-time angels and first-time entrepreneurs to the startup landscape. Being inexperienced they need help constructing agreements. Being poor they don't want to use lawyers. So they turn to free online resources like Brad Feld's blog on term sheets; they plagiarise existing work off LawDepot and Docracy, and they download the model contracts made available by Y Combinator, TechStars, Series Seed, and others. They use wizards such as those offered by WSGR, Orrick, and Cooley (which are themselves often based on business-integrity.com's document automation tools).

However, none of these solutions combine convenience, power, accessibility, and agility.

## Technical Insight

Computer science isn't really about computers. It's about information. Software is eating the world. And law is next.

Startups like Lex Machina attempt to analyze case law to assist litigators. Startups like Docracy and Clerky smooth the incorporation and investment workflows by providing standard document templates.

Those approaches are valuable. In contrast, we are more aligned with movements around design, visualization, and computational law. We bring computational thinking to the legal field: formal methods to prove correctness, domain specific languages to express essentials concisely, coverage testing, revision control, online collaboration for negotiation, data visualization.

## The Larger Market Opportunity

Zooming out from investment term sheets: what else can software eat?

Contracts generally. Contracts tend to fall into genres, and within each genre of contract it is possible to start with a standard form and customize it as necessary.

Business generally. The first wave of computational business happened decades ago: [EDI](http://en.wikipedia.org/wiki/Electronic_data_interchange). The next wave brings even more automation: automatic document assembly for directors' and shareholders' resolutions. Smart contracts.

Legalese 2.0 will obsolete lawyers, or at least put them back in their place -- in court doing dispute resolution, not in front of Microsoft Word charging $500/hour to copy and paste boilerplate.

After that, we'll obsolete corporate secretaries. Bookkeepers. Accountants. Corporate Secretaries. Tax specialists. The entire back office. With enough smarts, they can be automated.

## Existing Models

### Abstract Representation

Term sheet generator wizards create an intermediate representation that captures all the input submitted by the end-user. That representation is used to compile the long-form agreement. But the intermediat representation is not exposed to the end-user. Power users would prefer to access that representation, and edit it directly, because don't want to click through a wizard each time.

### Collaboration

## See Also

If you have just wandered across this, you should know that the project contains a few other resources:
- Evernote's CFSG Legal Shared Notebook
- Github: https://github.com/cofounders/legal.git
- Google Hangouts team chat
- Email correspondence dating around July / August 2014

