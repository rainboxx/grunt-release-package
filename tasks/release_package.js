/*
 * grunt-release-package
 *
 *
 * Copyright (c) 2015 Matthias Dietrich
 * Licensed under the MIT license.
 */

'use strict';

var fs = require('fs');
var q = require('q');
var crypto = require('crypto');
var grunt = require('grunt');
var nodegit = require('nodegit');
var path = require('path');
var chalk = require('chalk');
var readline = require('readline');

module.exports = function(grunt) {

    grunt.registerMultiTask('release_package', 'Grunt tasks for releasing a packaged version out of a project', function() {
        var self = this;

        var done    = self.async();
        var options = self.options({
            tmpFolder: undefined,
            jsonIndentation: 2,
            version: grunt.config('pkg') ? grunt.config('pkg').version : undefined,

            encoding: grunt.file.defaultEncoding,
            process: false,
            noProcess: [],
            timestamp: false,
            mode: false,

            committerName: undefined,
            committerEmail: undefined,
            commitMessage: 'v%VERSION%',
            tagName: 'v%VERSION%',
            tagMessage: 'Release v%VERSION%',
            pushTo: 'origin',
            branch: 'master',
            push: true,

            // GitHub certificate issue in OS X
            // TODO: check OS and only add callback on OS X
            certificateCheckCb: function() { return 1; },

            // SSH credentials via agent
            // TODO: make "use agent" an option?
            credentialsCb: function(url, userName) {
                return nodegit.Cred.sshKeyFromAgent(userName);
            },
        });

        var cloneOptions = {
            remoteCallbacks: {
                certificateCheck: options.certificateCheckCb,
                credentials: options.credentialsCb,
            },
            checkoutBranch: options.branch,
        };
        var remoteCallbacks = {
            certificateCheck: options.certificateCheckCb,
            credentials: options.credentialsCb,
        };
        var copyOptions = {
            encoding: options.encoding,
            process: options.process || options.processContent,
            noProcess: options.noProcess || options.processContentExclude,
        };
        var dirs = {};
        var tally = {
            dirs: 0,
            files: 0,
        };
        var repo;
        var index;
        var oid;

        grunt.verbose.writeln('Cloning ' + chalk.cyan(options.repository));

        nodegit
        .Clone(options.repository, options.tmpFolder, cloneOptions)
        .then(function(repository) {
            grunt.log.writeln('Cloned ' + chalk.cyan(options.repository) + ' into ' + chalk.cyan(options.tmpFolder));
            repo = repository;

            return q.resolve();
        })

        // Make changes:
        // - copy files if any given
        // - change version of "package" files
        .then(function() {

            // Copy files if given
            // Borrowed from grunt-contrib-copy
            self.files.forEach(function(filePair) {
                var isExpandedPair = filePair.orig.expand || false;

                filePair.src.forEach(function(src) {
                    var dest;

                    if (destIsDirectory(filePair.dest)) {
                        dest = (isExpandedPair) ? filePair.dest : unixifyPath(path.join(filePair.dest, src));
                    } else {
                        dest = filePair.dest;
                    }

                    if (grunt.file.isDir(src)) {
                        grunt.verbose.writeln('Creating ' + chalk.cyan(dest));
                        grunt.file.mkdir(dest);

                        if (options.timestamp) {
                            dirs[dest] = src;
                        }

                        tally.dirs++;
                    } else {
                        grunt.verbose.writeln('Copying ' + chalk.cyan(src) + ' -> ' + chalk.cyan(dest));
                        grunt.file.copy(src, dest, copyOptions);
                        syncTimestamp(src, dest);

                        if (options.mode !== false) {
                            fs.chmodSync(dest, (options.mode === true) ? fs.lstatSync(src).mode : options.mode);
                        }
                        tally.files++;
                    }
                });
            });

            if (options.timestamp) {
                Object.keys(dirs).sort(function (a, b) {
                    return b.length - a.length;
                }).forEach(function (dest) {
                    syncTimestamp(dirs[dest], dest);
                });
            }

            if (tally.dirs) {
                grunt.log.write('Created ' + chalk.cyan(tally.dirs.toString()) + ' directories');
            }

            if (tally.files) {
                grunt.log.write((tally.dirs ? ', copied ' : 'Copied ') + chalk.cyan(tally.files.toString()) + (tally.files === 1 ? ' file' : ' files'));
            }

            grunt.log.writeln();

            // Update package files.  Currently supported:
            // - bower.json
            // - package.json
            ['bower.json', 'package.json'].forEach(function(packageFile) {
                var filepath = options.tmpFolder + '/' + packageFile;
                var fileContent;

                if (!grunt.file.exists(filepath)) {
                    grunt.verbose.writeln('Package file ' + chalk.cyan(packageFile) + ' not found, ' + chalk.red('skipping'));
                    return false;
                }

                fileContent         = grunt.file.readJSON(filepath);
                fileContent.version = options.version;

                grunt.file.write(
                    filepath,
                    JSON.stringify(fileContent, null, options.jsonIndentation)
                );
                grunt.log.writeln('Updated ' + chalk.cyan(filepath));
            });

            // Return a promise for the chain
            return q.resolve();
        })

        // Check for committer's name and email, if not available: prompt for them
        .then(function() {
            var deferred = q.defer();
            var rl;

            // If both given, immediately return as resolved
            if (options.committerName && options.committerEmail) {
                return q.resolve();
            }

            grunt.log.writeln(chalk.red('Committer name or email missing, please enter:'));

            rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout
            });

            return q
            .when(true)
            .then(function() {
                var deferred = q.defer();

                if (!options.committerName) {
                    rl.question(
                        chalk.cyan('- Committer name') + ': ',
                        function(answer) {
                            options.committerName = answer;
                            deferred.resolve();
                        }
                    );
                    return deferred.promise;
                }

                return q.resolve();
            })
            .then(function() {
                var deferred = q.defer();

                if (!options.committerEmail) {
                    rl.question(
                        chalk.cyan('- Committer email') + ': ',
                        function(answer) {
                            options.committerEmail = answer;
                            deferred.resolve();
                        }
                    );
                    return deferred.promise;
                }

                return q.resolve();
            })
            .then(function() {
                rl.close();
            });
        })

        // Add new and changed files, then commit if something really changed
        .then(function() {
            return repo
            .openIndex()
            .then(function(indexResult) {
                index = indexResult;
                return index.read(1);
            })
            .then(function() {
                return repo
                .getStatus()
                .then(function(statuses) {
                    return !statuses.length ? q.reject('Nothing to commit') : q.resolve();
                });
            })
            .then(function() {
                return index.addAll(
                    undefined,
                    undefined,
                    function(path, matchedPattern) {
                        grunt.verbose.writeln('Staging ' + chalk.cyan(path));
                        return 0;
                    }
                );
            })
            .then(function(foo) {
                return index.write();
            })
            .then(function() {
                return index.writeTree();
            })
            .then(function(oidResult) {
                oid = oidResult;
                return nodegit.Reference.nameToId(repo, "HEAD");
            })
            .then(function(head) {
                return repo.getCommit(head);
            })
            .then(function(parent) {
                var committer     = nodegit.Signature.now(options.committerName, options.committerEmail);
                var commitMessage = options.commitMessage.replace('%VERSION%', options.version);

                return repo
                .createCommit("HEAD", committer, committer, commitMessage, oid, [parent])
                .then(function(commitId) {
                    grunt.verbose.writeln('Created commit ' + chalk.cyan(commitId.allocfmt()));
                    return q.resolve(commitId);
                });
            });
        })

        // Create tag from the latest commit
        .then(function(commitId) {
            var tagName    = options.tagName.replace('%VERSION%', options.version);
            var tagMessage = options.tagMessage.replace('%VERSION%', options.version);

            return repo
            .createTag(commitId, tagName, tagMessage)
            .then(function(tag) {
                grunt.verbose.writeln('Created tag ' + chalk.cyan(tag.name()));
                return q.resolve(tag);
            });
        })

        // Push to given remote
        .then(function(tag) {
            if (!options.push) {
                grunt.log.writeln('Push ' + chalk.red('disabled') + ', remember to push manually if necessary');
                return q.resolve();
            }

            return repo
            .getRemote(options.pushTo)
            .then(function(remote) {
                var refSpec = ['refs/tags/' + tag.name(), 'refs/heads/' + options.branch];

                remote.setCallbacks(remoteCallbacks);

                return remote.push(
                    [refSpec.map(function(r) { return r + ':' + r; })],
                    null,
                    repo.defaultSignature(),
                    'Push to master'
                )
                .then(function(tag) {
                    grunt.verbose.writeln('Pushed to ' + chalk.cyan(options.pushTo));
                    return q.resolve();
                });
            });
        })
        .then(function() {
            done();
        })
        .catch(grunt.fail.fatal);
    });

    var destIsDirectory = function(dest) {
        return grunt.util._.endsWith(dest, '/') ? true : false;
    };

    // Borrowed from grunt-contrib-copy

    var unixifyPath = function(filepath) {
        if (process.platform === 'win32') {
            return filepath.replace(/\\/g, '/');
        } else {
            return filepath;
        }
    };

    var md5 = function (src) {
        var md5Hash = crypto.createHash('md5');
        md5Hash.update(fs.readFileSync(src));

        return md5Hash.digest('hex');
    };

    var syncTimestamp = function(src, dest) {
        var stat = fs.lstatSync(src);
        if (path.basename(src) !== path.basename(dest)) {
            return;
        }

        if (stat.isFile() && md5(src) !== md5(dest)) {
            return;
        }

        fs.utimesSync(dest, stat.atime, stat.mtime);
    };
};
