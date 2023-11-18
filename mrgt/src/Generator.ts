import { log } from "@tno-terminology-design/utils"
import { TuCBuilder } from "./TuC.js"
import { writeFile } from "./Handler.js"
import { type SAF, type Version } from "@tno-terminology-design/utils"
import { type Entry } from "@tno-terminology-design/utils"

import path = require("path")
import yaml = require("js-yaml")
import { MrgBuilder } from "@tno-terminology-design/utils"

export class Generator {
  public vsntag: string
  saf: SAF

  public constructor({ vsntag, saf }: { vsntag: string; saf: SAF }) {
    this.vsntag = vsntag
    this.saf = saf
  }

  public initialize(): void {
    log.info("Initializing generator...")

    // Check if the vsntag exists in the SAF
    if (this.vsntag) {
      const vsn = this.saf.versions?.find((vsn) => vsn.vsntag === this.vsntag)
      if (vsn) {
        log.info(`\x1b[1;37mProcessing version '${vsn.vsntag}' (mrg.${this.saf.scope.scopetag}.${vsn.vsntag}.yaml)...`)
        this.generate(vsn)
      } else {
        // check altvsntags
        const vsn = this.saf.versions?.find((vsn) => vsn.altvsntags.includes(this.vsntag))

        if (vsn) {
          log.info(
            `\x1b[1;37mProcessing version '${vsn.vsntag}' (altvsn '${this.vsntag}') (mrg.${this.saf.scope.scopetag}.${vsn.vsntag}.yaml)...`
          )
          this.generate(vsn)
        } else {
          throw new Error(`The specified vsntag '${this.vsntag}' was not found in the SAF`)
        }
      }
    } else {
      // If no vsntag was specified, process all versions
      log.info(`No vsntag was specified. Processing all versions...`)
      if (this.saf.versions?.length === 0) {
        throw new Error(`No versions were found in the SAF`)
      }
      this.saf.versions?.forEach((vsn) => {
        log.info(`\x1b[1;37mProcessing version '${vsn.vsntag}' (mrg.${this.saf.scope.scopetag}.${vsn.vsntag}.yaml)...`)
        this.generate(vsn)
      })
    }

    // Handle synonymOf entries if they exist in curated text
    if (TuCBuilder.synonymOf.length > 0) {
      this.synonymOf()
    }
  }

  private synonymOf(): void {
    log.info(`\x1b[1;37mProcessing synonymOf entries...`)
    let mrgfileWarnings: string[]
    TuCBuilder.synonymOf?.forEach((synonymOf, index) => {
      // wrangle the synonymOf field using a regex
      const properties = synonymOf.synonymOf!.match(
        /(?:(?<term>[a-z0-9_-]+))(?:(?:(?<identifier>@)(?:(?<scopetag>[a-z0-9_-]+)?))?(?::(?<vsntag>.+))?)/
      )
      if (properties?.groups) {
        let entrymatch: Entry | undefined
        // if no identifier (@) is specified, refer to the ctextmap
        if (!properties.groups.identifier) {
          entrymatch = TuCBuilder.cTextMap?.find((ctext) => ctext.term === properties!.groups!.term)
          // if the identifier is @, refer to the MRG
        } else {
          const mrgfile = `mrg.${properties.groups.scopetag ?? this.saf.scope.scopetag}.${
            properties.groups.vsntag ?? this.saf.scope.defaultvsn
          }.yaml`
          // if the mrgfile exists as a MRG.instance, use that instance. Otherwise, create a new instance
          const mrg =
            MrgBuilder.instances?.find((mrg) => mrg.filename === mrgfile) ??
            new MrgBuilder({ filename: mrgfile, saf: this.saf, populate: false }).mrg
          if (mrg) {
            entrymatch = mrg.entries?.find((entry) => entry.term === properties!.groups!.term)
            if (!entrymatch) {
              // remove the synonymOf entry if it doesn't exist in the MRG
              TuCBuilder.synonymOf.splice(index, 1)
              log.warn(`\tTerm '${properties!.groups!.term}' not found in MRG '${mrgfile}'`)
            }
          } else {
            // remove the synonymOf entry if the MRG cannot be found
            TuCBuilder.synonymOf.splice(index, 1)
            if (!mrgfileWarnings.includes(mrgfile)) {
              log.warn(`\tMRG '${mrgfile}' not found`)
              mrgfileWarnings.push(mrgfile)
            }
          }
        }

        if (entrymatch) {
          // remove fields that are generated by the MRGT
          Object.keys(synonymOf).forEach((key) => {
            if (["headingids", "navurl", "locator", "scopetag"].includes(key.toLowerCase())) {
              delete synonymOf[key]
            }
          })
          // merge the synonymOf entry with the MRG entry
          TuCBuilder.synonymOf[index] = { ...entrymatch, ...TuCBuilder.synonymOf[index] }
        }
      }
    })

    // Handle TuC.synonymOf entries if they exist in TuC.entries
    TuCBuilder.instances
      .filter((i) => i.tuc.cText)
      ?.forEach((instance) => {
        // find matches in TuC.entries for each TuC.synonymOf
        TuCBuilder.synonymOf?.forEach((synonymOf) => {
          const index = instance.tuc.entries?.findIndex((entry) => {
            // see if every field in entry matches the corresponding field in synonymOf
            return Object.keys(entry).every((key) => {
              return entry[key] === synonymOf[key]
            })
          })
          if (index >= 0) {
            instance.tuc.entries[index] = synonymOf
          }
        })

        // output the modified tuc.entries array to a file
        writeFile(
          path.join(this.saf.scope.localscopedir, this.saf.scope.glossarydir, instance.tuc.filename),
          yaml.dump(instance.output(), { forceQuotes: true, noRefs: true })
        )
      })
  }

  public generate(vsn: Version): void {
    const build = new TuCBuilder({ vsn: vsn })
    const glossarydir = path.join(this.saf.scope.localscopedir, this.saf.scope.glossarydir)

    // Output the MRG to a file
    const mrgFile = `mrg.${build.tuc.terminology.scopetag}.${build.tuc.terminology.vsntag}.yaml`
    writeFile(path.join(glossarydir, mrgFile), yaml.dump(build.output(), { forceQuotes: true, noRefs: true }))

    if (vsn.altvsntags || this.saf.scope.defaultvsn === build.tuc.terminology.vsntag) {
      log.info(`\tCreating duplicates...`)
    }

    // if the version is the default version, create a duplicate {mrg.{import-scopetag}.yaml}
    if (
      this.saf.scope.defaultvsn === build.tuc.terminology.vsntag ||
      build.tuc.terminology.altvsntags?.includes(this.saf.scope.defaultvsn)
    ) {
      const defaultmrgURL = path.join(glossarydir, `mrg.${build.tuc.terminology.scopetag}.yaml`)
      writeFile(defaultmrgURL, yaml.dump(mrgFile, { forceQuotes: true, noRefs: true }))
      log.trace(`\t\t'${path.basename(defaultmrgURL)}' (default) > '${mrgFile}'`)
    }

    // Create a duplicate for every altvsntag
    if (typeof vsn.altvsntags === "string") {
      vsn.altvsntags = [vsn.altvsntags]
    }
    vsn.altvsntags?.forEach((altvsntag) => {
      const altmrgURL = path.join(glossarydir, `mrg.${build.tuc.terminology.scopetag}.${altvsntag}.yaml`)
      writeFile(altmrgURL, yaml.dump(mrgFile, { forceQuotes: true, noRefs: true }))
      log.trace(`\t\t'${path.basename(altmrgURL)}' (altvsn)`)
    })
  }
}
