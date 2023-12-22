import fs = require("fs")
import path = require("path")
import yaml = require("js-yaml")

export interface MRG {
  filename?: string
  terminology: Terminology
  scopes?: Scopes[]
  entries: Entry[]
}

interface Scopes {
  scopetag: string
  scopedir: string
}

export interface Terminology {
  scopetag: string
  scopedir: string
  curatedir: string
  vsntag: string
  altvsntags: string[]
  [key: string]: unknown
}

export interface Entry {
  scopetag: string
  vsntag: string
  locator: string
  navurl: string
  headingids: string[]
  termid: string
  term: string
  termType?: string
  bodyFile?: string
  glossaryTerm?: string
  glossaryText?: string
  synonymOf?: string
  grouptags?: string[]
  formPhrases?: string[]
  [key: string]: unknown
}

/**
 * The MrgBuilder class handles the retrieval and processing of an MRG (Machine Readable Glossary).
 * An MRG is retrieved based on the `filename` and processed into an MRG object.
 * The MRG object with its MRG entries can then be used to populate the runtime glossary.
 */
export class MrgBuilder {
  static instances: MRG[] = []
  mrg: MRG

  public constructor({ mrgpath }: { mrgpath: string }) {
    this.mrg = this.getMrgMap(mrgpath)
    if (this.mrg !== undefined) {
      this.mrg.filename = path.basename(mrgpath)

      MrgBuilder.instances.push(this.mrg)
    }
  }

  /**
   * Reads the MRG at `mrgpath` and maps it as the this.mrg MRG object.
   * @param mrgpath - The full path of the MRG to be retrieved.
   * @returns - The MRG as an MRG object.
   */
  public getMrgMap(mrgpath: string): MRG {
    try {
      // try to load the MRG map from the `mrgpath`
      const mrgfile = fs.readFileSync(mrgpath, "utf8")
      this.mrg = yaml.load(mrgfile) as MRG

      // check for missing required properties in MRG terminology
      type TerminologyProperty = keyof Terminology
      const requiredProperties: TerminologyProperty[] = ["scopetag", "scopedir", "curatedir", "vsntag"]
      const terminology = this.mrg.terminology
      const missingProperties = requiredProperties.filter((prop) => terminology[prop] == null)

      if (missingProperties.length > 0) {
        throw new Error(`Missing required property in MRG at '${mrgpath}': '${missingProperties.join("', '")}'`)
      }

      const requiredEntryProperties = ["term", "scopetag", "locator"]

      for (const entry of this.mrg.entries) {
        // check for missing required properties in MRG entries
        const missingProperties = requiredEntryProperties.filter((prop) => entry[prop] == null)

        if (missingProperties.length > 0) {
          // create a reference to the problematic entry using the first three property-value pairs
          const reference = Object.keys(entry)
            .slice(0, 3)
            .map((prop) => `${prop}: '${entry[prop]}'`)
            .join(", ")

          throw new Error(
            `MRG entry missing required property: '${missingProperties.join("', '")}'. 
            Entry starts with values ${reference}`
          )
        }
      }
    } catch (err) {
      throw new Error(`E005 An error occurred while attempting to load an MRG: ${err}`)
    }

    return this.mrg
  }
}

/**
 * Returns an MRG class instance.
 * @returns The MRG class instance.
 */
export function getMRGinstance(scopedir: string, glossarydir: string, filename: string): MRG {
  let mrg: MRG

  // Check if an MRG class instance with the `filename` property of `mrgFile` has already been loaded
  for (const instance of MrgBuilder.instances) {
    if (instance.filename === filename) {
      mrg = instance
      break
    }
  }
  // If no existing MRG class instance was found, build the MRG according to the `mrgpath`
  if (mrg == null) {
    mrg = new MrgBuilder({ mrgpath: path.join(scopedir, glossarydir, filename) }).mrg
  }

  return mrg
}

export function getMRGenty(entries: Entry[], origin: string, id: string, type?: string): Entry {
  let entry: Entry

  // Find the matching entry in mrg.entries based on the term
  let matches = entries.filter((entry) => entry.term === id || entry.formPhrases?.includes(id))
  if (matches.length > 1 && type != null) {
    matches = matches.filter((entry) => entry.termType === type)
  }

  if (matches.length === 1) {
    entry = matches[0]
  } else if (matches.length === 0) {
    throw new Error(`could not be matched with an MRG entry in '${origin}`)
  } else if (matches.length > 1) {
    const matchingTermIds = matches.map((entry) => entry.termid).join("', '")
    throw new Error(`has multiple matching MRG entries in '${origin}'. Matching termids: '${matchingTermIds}'`)
  }

  return entry
}
