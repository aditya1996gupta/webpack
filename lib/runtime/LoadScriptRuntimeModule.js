/*
	MIT License http://www.opensource.org/licenses/mit-license.php
*/

"use strict";

const { SyncWaterfallHook } = require("tapable");
const Compilation = require("../Compilation");
const RuntimeGlobals = require("../RuntimeGlobals");
const Template = require("../Template");
const HelperRuntimeModule = require("./HelperRuntimeModule");

/** @typedef {import("../Chunk")} Chunk */
/** @typedef {import("../Compilation")} Compilation */
/** @typedef {import("../Compiler")} Compiler */

/**
 * @typedef {Object} LoadScriptCompilationHooks
 * @property {SyncWaterfallHook<[string, Chunk]>} createScript
 */

/** @type {WeakMap<Compilation, LoadScriptCompilationHooks>} */
const compilationHooksMap = new WeakMap();

class LoadScriptRuntimeModule extends HelperRuntimeModule {
	/**
	 * @param {Compilation} compilation the compilation
	 * @returns {LoadScriptCompilationHooks} hooks
	 */
	static getCompilationHooks(compilation) {
		if (!(compilation instanceof Compilation)) {
			throw new TypeError(
				"The 'compilation' argument must be an instance of Compilation"
			);
		}
		let hooks = compilationHooksMap.get(compilation);
		if (hooks === undefined) {
			hooks = {
				createScript: new SyncWaterfallHook(["source", "chunk"])
			};
			compilationHooksMap.set(compilation, hooks);
		}
		return hooks;
	}

	constructor() {
		super("load script");
	}

	/**
	 * @returns {string} runtime code
	 */
	generate() {
		const { compilation } = this;
		const { runtimeTemplate, outputOptions } = compilation;
		const {
			jsonpScriptType: scriptType,
			chunkLoadTimeout: loadTimeout,
			crossOriginLoading
		} = outputOptions;
		const fn = RuntimeGlobals.loadScript;

		const { createScript } = LoadScriptRuntimeModule.getCompilationHooks(
			compilation
		);

		const code = Template.asString([
			"script = document.createElement('script');",
			scriptType ? `script.type = ${JSON.stringify(scriptType)};` : "",
			"script.charset = 'utf-8';",
			`script.timeout = ${loadTimeout / 1000};`,
			`if (${RuntimeGlobals.scriptNonce}) {`,
			Template.indent(
				`script.setAttribute("nonce", ${RuntimeGlobals.scriptNonce});`
			),
			"}",
			'script.setAttribute("data-webpack", key);',
			`script.src = url;`,
			crossOriginLoading
				? Template.asString([
						"if (script.src.indexOf(window.location.origin + '/') !== 0) {",
						Template.indent(
							`script.crossOrigin = ${JSON.stringify(crossOriginLoading)};`
						),
						"}"
				  ])
				: ""
		]);

		return Template.asString([
			"var inProgress = {};",
			"// loadScript function to load a script via script tag",
			`${fn} = ${runtimeTemplate.basicFunction("url, done, key", [
				"if(inProgress[url]) { inProgress[url].push(done); return; }",
				"var script, needAttach;",
				"if(key !== undefined) {",
				Template.indent([
					'var scripts = document.getElementsByTagName("script");',
					"for(var i = 0; i < scripts.length; i++) {",
					Template.indent([
						"var s = scripts[i];",
						'if(s.getAttribute("src") == url || s.getAttribute("data-webpack") == key) { script = s; break; }'
					]),
					"}"
				]),
				"}",
				"if(!script) {",
				Template.indent([
					"needAttach = true;",
					createScript.call(code, this.chunk)
				]),
				"}",
				"inProgress[url] = [done];",
				"var onScriptComplete = " +
					runtimeTemplate.basicFunction(
						"event",
						Template.asString([
							`onScriptComplete = ${runtimeTemplate.basicFunction("", "")}`,
							"// avoid mem leaks in IE.",
							"script.onerror = script.onload = null;",
							"clearTimeout(timeout);",
							"var doneFns = inProgress[url];",
							"delete inProgress[url];",
							"script.parentNode.removeChild(script);",
							`doneFns && doneFns.forEach(${runtimeTemplate.returningFunction(
								"fn(event)",
								"fn"
							)});`
						])
					),
				";",
				`var timeout = setTimeout(${runtimeTemplate.basicFunction(
					"",
					"onScriptComplete({ type: 'timeout', target: script })"
				)}, ${loadTimeout});`,
				"script.onerror = script.onload = onScriptComplete;",
				"needAttach && document.head.appendChild(script);"
			])};`
		]);
	}
}

module.exports = LoadScriptRuntimeModule;
