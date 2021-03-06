import { ensureFile, pathExists } from "fs-extra";
import RegClient = require("npm-registry-client");
import * as url from "url";

import { Fetcher, readFile, readJson, sleep, writeJson } from "../util/io";
import { createTgz } from "../util/tgz";
import { identity, joinPaths, mapToRecord, recordToMap, some } from "../util/util";

import { getSecret, Secret } from "./secrets";
import { npmApi, npmRegistry, npmRegistryHostName } from "./settings";

function packageUrl(packageName: string): string {
	return url.resolve(npmRegistry, packageName);
}

const cacheDir = joinPaths(__dirname, "..", "..", "cache");
const cacheFile = joinPaths(cacheDir, "npmInfo.json");

export type NpmInfoCache = ReadonlyMap<string, NpmInfo>;

export interface NpmInfoRaw {
	readonly version: string;
	readonly "dist-tags": {
		readonly [tag: string]: string;
	};
	readonly versions: NpmInfoRawVersions;
	readonly time: { readonly modified: string; };
}
export interface NpmInfoRawVersions {
	readonly [version: string]: NpmInfoVersion;
}

// Processed npm info. Intentially kept small so it can be cached.
export interface NpmInfo {
	readonly version: string;
	readonly distTags: Map<string, string>;
	readonly versions: Map<string, NpmInfoVersion>;
	readonly timeModified: string;
}
export interface NpmInfoVersion {
	readonly typesPublisherContentHash: string;
	readonly deprecated?: string;
}

export class CachedNpmInfoClient {
	static async with<T>(uncachedClient: UncachedNpmInfoClient, cb: (client: CachedNpmInfoClient) => Promise<T>): Promise<T> {
		const client = new this(uncachedClient, await pathExists(cacheFile)
			? recordToMap(await readJson(cacheFile) as Record<string, NpmInfoRaw>, npmInfoFromJson)
			: new Map());
		const res = await cb(client);
		await client.writeCache();
		return res;
	}

	private constructor(private readonly uncachedClient: UncachedNpmInfoClient, private readonly cache: Map<string, NpmInfo>) {}

	async getNpmInfo(escapedPackageName: string, contentHash: string | undefined): Promise<NpmInfo | undefined> {
		const cached = this.cache.get(escapedPackageName);
		if (cached !== undefined && contentHash !== undefined && some(cached.versions.values(), v => v.typesPublisherContentHash === contentHash)) {
			return cached;
		}

		const info = await this.uncachedClient.fetchNpmInfo(escapedPackageName);
		if (info !== undefined && contentHash !== undefined) {
			this.cache.set(escapedPackageName, info);
		}
		return info;
	}

	private async writeCache(): Promise<void> {
		await ensureFile(cacheFile);
		await writeJson(cacheFile, mapToRecord(this.cache, jsonFromNpmInfo));
	}
}

export class UncachedNpmInfoClient {
	private readonly fetcher = new Fetcher();

	async fetchNpmInfo(escapedPackageName: string): Promise<NpmInfo | undefined> {
		const raw = await this.fetchRawNpmInfo(escapedPackageName);
		await sleep(0.01); // If we don't do this, npm resets the connection?
		return raw === undefined ? undefined : npmInfoFromJson(raw);
	}

	async fetchRawNpmInfo(escapedPackageName: string): Promise<NpmInfoRaw | undefined> {
		const info = await this.fetcher.fetchJson({
			hostname: npmRegistryHostName,
			path: escapedPackageName,
			retries: true,
		}) as { readonly error: string } | NpmInfoRaw;
		if ("error" in info) {
			if (info.error === "Not found") { return undefined; }
			throw new Error(`Error getting version at ${escapedPackageName}: ${info.error}`);
		}
		return info;
	}

	// See https://github.com/npm/download-counts
	async getDownloads(packageName: string): Promise<number> {
		const json = await this.fetcher.fetchJson({
			hostname: npmApi,
			path: `/downloads/point/last-month/${packageName}`,
			retries: true,
		}) as { downloads: number };
		// Json may contain "error" instead of "downloads", because some packages aren't available on NPM.
		return json.downloads || 0;
	}
}

export class NpmPublishClient {
	static async create(config?: RegClient.Config): Promise<NpmPublishClient> {
		const token = await getSecret(Secret.NPM_TOKEN);
		return new this(new RegClient(config), { token });
	}

	private constructor(private readonly client: RegClient, private readonly auth: RegClient.Credentials) {}

	async publish(publishedDirectory: string, packageJson: {}, dry: boolean): Promise<void> {
		const readme = await readFile(joinPaths(publishedDirectory, "README.md"));

		return new Promise<void>((resolve, reject) => {
			const body = createTgz(publishedDirectory, reject);
			const metadata = { readme, ...packageJson };

			const params: RegClient.PublishParams = {
				access: "public",
				auth: this.auth,
				metadata,
				body,
			};

			if (dry) {
				resolve();
			} else {
				this.client.publish(npmRegistry, params, err => {
					if (err) {
						reject(err);
					} else {
						resolve();
					}
				});
			}
		});
	}

	tag(packageName: string, version: string, tag: string): Promise<void> {
		const params = {
			version,
			tag,
			auth: this.auth
		};
		return promisifyVoid(cb => { this.client.tag(packageUrl(packageName), params, cb); });
	}

	deprecate(packageName: string, version: string, message: string): Promise<void> {
		const url = packageUrl(packageName.replace("/", "%2f"));
		const params = {
			message,
			version,
			auth: this.auth,
		};
		return promisifyVoid(cb => { this.client.deprecate(url, params, cb); });
	}
}

function npmInfoFromJson(n: NpmInfoRaw): NpmInfo {
	return {
		version: n.version,
		distTags: recordToMap(n["dist-tags"], identity),
		// Callback ensures we remove any other properties
		versions: recordToMap(n.versions, ({ typesPublisherContentHash, deprecated }) => ({ typesPublisherContentHash, deprecated })),
		timeModified: n.time.modified,
	};
}

function jsonFromNpmInfo(n: NpmInfo): NpmInfoRaw {
	return {
		version: n.version,
		"dist-tags": mapToRecord(n.distTags),
		versions: mapToRecord(n.versions),
		time: { modified: n.timeModified },
	};
}

function promisifyVoid(callsBack: (cb: (error: Error | undefined) => void) => void): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		callsBack(error => {
			if (error) {
				reject(error);
			} else {
				resolve();
			}
		});
	});
}
