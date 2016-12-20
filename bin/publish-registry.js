"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
const path = require("path");
const package_generator_1 = require("./lib/package-generator");
const yargs = require("yargs");
const common_1 = require("./lib/common");
const npm_client_1 = require("./lib/npm-client");
const versions_1 = require("./lib/versions");
const io_1 = require("./util/io");
const logging_1 = require("./util/logging");
const util_1 = require("./util/util");
const packageName = "types-registry";
const outputPath = path.join(common_1.settings.outputPath, packageName);
const readme = `This package contains a listing of all packages published to the @types scope on NPM.
Generated by [types-publisher](https://github.com/Microsoft/types-publisher).`;
if (!module.parent) {
    if (!common_1.existsTypesDataFileSync()) {
        console.log("Run parse-definitions first!");
    }
    else if (!versions_1.default.existsSync()) {
        console.log("Run calculate-versions first!");
    }
    else {
        const dry = !!yargs.argv.dry;
        util_1.done(main(dry));
    }
}
function main(dry = false) {
    return __awaiter(this, void 0, void 0, function* () {
        const [log, logResult] = logging_1.logger();
        log("=== Publishing types-registry ===");
        // Only need to publish a new registry if there are new packages.
        const added = yield versions_1.readAdditions();
        if (added.length) {
            log(`New packages have been added: ${JSON.stringify(added)}, so publishing a new registry`);
            yield generateAndPublishRegistry(log, dry);
        }
        else {
            log("No new packages published, so no need to publish new registry.");
        }
        yield logging_1.writeLog("publish-registry.md", logResult());
    });
}
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = main;
function generateAndPublishRegistry(log, dry) {
    return __awaiter(this, void 0, void 0, function* () {
        // Don't include not-needed packages in the registry.
        const typings = yield common_1.readTypings();
        const last = yield fetchLastPatchNumber();
        const packageJson = generatePackageJson(last + 1);
        yield generate(typings, packageJson, log);
        yield publish(packageJson, dry);
    });
}
function generate(typings, packageJson, log) {
    return __awaiter(this, void 0, void 0, function* () {
        yield package_generator_1.clearOutputPath(outputPath, log);
        yield writeOutputFile("package.json", packageJson);
        yield writeOutputFile("index.json", generateRegistry(typings));
        yield writeOutputFile("README.md", readme);
        function writeOutputFile(filename, content) {
            return io_1.writeJson(path.join(outputPath, filename), content);
        }
    });
}
function publish(packageJson, dry) {
    return __awaiter(this, void 0, void 0, function* () {
        const client = yield npm_client_1.default.create();
        yield client.publish(outputPath, packageJson, dry);
    });
}
function fetchLastPatchNumber() {
    return __awaiter(this, void 0, void 0, function* () {
        return (yield versions_1.fetchVersionInfoFromNpm(packageName, /*isPrerelease*/ false)).version.patch;
    });
}
function generatePackageJson(patch) {
    return {
        name: packageName,
        version: `0.1.${patch}`,
        description: "A registry of TypeScript declaration file packages published within the @types scope.",
        repository: {
            type: "git",
            url: "https://github.com/Microsoft/types-publisher.git"
        },
        keywords: [
            "TypeScript",
            "declaration",
            "files",
            "types",
            "packages"
        ],
        author: "Microsoft Corp.",
        license: "Apache-2.0"
    };
}
function generateRegistry(typings) {
    const entries = {};
    for (const { typingsPackageName } of typings) {
        entries[typingsPackageName] = 1;
    }
    return { entries };
}
//# sourceMappingURL=publish-registry.js.map