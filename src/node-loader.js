var fs = require('fs');
var path = require('path');
var utils = require('loader-utils');
var nunjucks = require('nunjucks');
var fsLoader = require('./fs-loader');

function getConfig(that, name) {
	var config;
	configPath = require.resolve(path.resolve(process.cwd(), name));
	if ( configPath ) {
		try {
			var data = fs.readFileSync(configPath, 'utf8');
			config = that.exec(data, name);
			if ( config ) {
				that.addDependency(configPath);
			}
			return config;
		} catch (e) {
			throw new Error(e);
		}
	}
}

function getRootPath(rootPaths, lookUp) {
	const contains = rootPaths.filter(opt => lookUp.indexOf(opt) === 0)

	return  contains.reduce((acc, item) => {
		if (!acc) { return item; }

		return item.length > acc.length ? item : acc;
	}, null);
}

module.exports = function(source) {
	var opt = utils.getOptions(this);
	var paths = Array.isArray(opt.root) ? opt.root : [opt.root];
	var context;
	const rootPath = getRootPath(paths, this.resourcePath);

	if ( typeof opt.context === "string" ) {
		context = getConfig(this, opt.context);
	}

	context = JSON.stringify(context || opt.context || {});

	var njkPath = require.resolve('nunjucks');
	this.addDependency(njkPath);

	var loaderPath = require.resolve('./fs-loader');
	this.addDependency(loaderPath);

	var njkSlimPath = require.resolve('nunjucks/browser/nunjucks-slim');
	var nunjucksSlim = utils.stringifyRequest(this, '!' + njkSlimPath);
    this.addDependency(njkSlimPath);
    
    let jinjaCompatSetup = "";
    if ( opt.jinjaCompat ) {
        nunjucks.installJinjaCompat();
        jinjaCompatSetup = 'nunjucks.installJinjaCompat();';
    }

    var env = new nunjucks.Environment(new fsLoader(paths, this.addDependency));
    
    // filters have to be added in the returned module,
    // so we have to actually save to source code string :(
    let customFilterSetup = '';
    if ( opt.filters ) {
        Object.keys(opt.filters).forEach((key) => {
        env.addFilter(key, opt.filters[key]);

        customFilterSetup += `
            env.addFilter("${key}", ${opt.filters[key].toString()});
        `;
        });
    }

	var name = path.relative(rootPath, this.resourcePath);

	this.addContextDependency(rootPath);

	var precompiledTemplates = nunjucks.precompile(rootPath, {
		env: env,
		include: opt.includeTemplates || [/.*\.(njk|nunjucks|html|tpl|tmpl)$/],
  });
  
  precompiledTemplates = precompiledTemplates.replace(/output \+= runtime\.suppressValue\(\(lineno = \d+?, colno = \d+?, runtime\.callWrap\(runtime\.contextOrFrameLookup\(context, frame, "require"\), "require", context, \["(.+?)"\]\)\), env\.opts\.autoescape\);/g, function (match, p1) {
    return `output += require('${p1}');`;
  })

  	return `// Return function to HtmlWebpackPlugin
		// Allows Data var to be passed to templates
		// Then render templates with both HtmlWebpackPlugin Data
		// and Nunjucks Context
		var nunjucks = require(${nunjucksSlim});

		// Create fake window object to store nunjucks precompiled templates
		global.window = {};

        ${precompiledTemplates}

        ${jinjaCompatSetup}

        var env = new nunjucks.Environment(new nunjucks.PrecompiledLoader());
        ${customFilterSetup}

		var context = JSON.parse('${context}');

		module.exports = env.render("${name}", context);

		module.exports = function(data) {
			return env.render("${name}", Object.assign({}, context, data));
		}`
}
