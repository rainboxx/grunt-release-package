/*
 * grunt-release-package
 *
 *
 * Copyright (c) 2015 Matthias Dietrich
 * Licensed under the MIT license.
 */

'use strict';

var NodeGit = require('nodegit');

module.exports = function(grunt) {

  // Project configuration.
  grunt.initConfig({
    pkg: grunt.file.readJSON('package.json'),

    jshint: {
      all: [
        'Gruntfile.js',
        'tasks/*.js',
        '<%= nodeunit.tests %>'
      ],
      options: {
        jshintrc: '.jshintrc'
      }
    },

    // Before generating any new files, remove any previously-created files.
    clean: {
      tests: ['tmp']
    },

    // Configuration to be run (and then tested).
    release_package: {
      test: {
        options: {
          tmpFolder: 'tmp',
          repository: 'git@github.com:rainboxx/test-repo.git',
          commitMessage: 'v%VERSION%',
          committerName: 'Matthias',
          committerEmail: 'perl@rainboxx.de',
          push: false,
        },
        files: [
          { expand: true, src: ['*.md'], dest: 'tmp/' }
        ]
      }
    },

    // Unit tests.
    nodeunit: {
      tests: ['test/*_test.js']
    }

  });

  // Actually load this plugin's task(s).
  grunt.loadTasks('tasks');

  // These plugins provide necessary tasks.
  grunt.loadNpmTasks('grunt-contrib-jshint');
  grunt.loadNpmTasks('grunt-contrib-clean');
  grunt.loadNpmTasks('grunt-contrib-nodeunit');

  // Whenever the "test" task is run, first clean the "tmp" dir, then run this
  // plugin's task(s), then test the result.
  grunt.registerTask('test', ['clean', 'release_package', 'nodeunit']);

  // By default, lint and run all tests.
  grunt.registerTask('default', ['jshint', 'test']);

};
