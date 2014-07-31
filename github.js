/*
 
    github.js

    a GitHubBackend backend API for SNAP!

    written by Gubolin, based on cloud.js by Jens Mönig

    Copyright (C) 2014 by Jens Mönig, Gubolin

    This file is part of Snap!.

    Snap! is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as
    published by the Free Software Foundation, either version 3 of
    the License, or (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.

*/

// Global settings /////////////////////////////////////////////////////

/*global modules, IDE_Morph, SnapSerializer, nop,
localize*/

modules.github = '2014-July-31';

// Global stuff

var GitHubBackend;

var GitHub = new GitHubBackend();

// GitHubBackend /////////////////////////////////////////////////////////////

function GitHubBackend(url) {
    this.gh = null;
    this.username = null;
    this.password = null; // TODO saved as plain text
}

GitHubBackend.prototype.clear = function () {
    this.gh = null;
    this.username = null;
    this.password = null;
};

// GitHubBackend: Snap! API

GitHubBackend.prototype.getProject = function (
    userName,
    projectName,
    callBack,
    errorCall
) {
    var myself = this;

    if (myself.gh === null) {
        myself.gh = new Octokit();
    }

    var repo = myself.gh.getRepo(userName, projectName);
    var branch = repo.getBranch(); // master (default)
    var media, pdata;

    branch.read('snap.xml', false).then(
        function (sourceContent) {
            branch.read('media.xml', false).then( // true for binary
                function (mediaContent) {
                    callBack.call(
                        null,
                        sourceContent.content,
                        mediaContent.content
                    );
                },
                function (error) {
                    errorCall.call(this, error, 'GitHub');
                }
            );
        },
        function (error) {
            errorCall.call(this, error, 'GitHub');
        }
    );
};

GitHubBackend.prototype.login = function (
    username,
    password,
    validateData,
    callBack,
    errorCall
) {
    var myself = this;
    var me;

    myself.gh = new Octokit({
        username: username,
        password: password
    });

    if (validateData === true) {
        me = myself.gh.getUser();
        if (me !== null) {
            me.getInfo().then(
                function(info) {
                    myself.username = username;
                    myself.password = password;

                    callBack.call(myself);
                },
                function (error) {
                    errorCall.call(this, error, 'GitHub');
                }
            );
        } else {
            errorCall.call(myself, localize('Something went wrong :('), 'GitHub');
        }
    } else {
        myself.username = username;
        myself.password = password;

        callBack.call(myself);
    }
};

GitHubBackend.prototype.saveProject = function (ide, callBack, errorCall) {
    var myself = this,
        pdata,
        media;
    var repoName = ide.projectName.replace(/[^\w-]/g, ''); // TODO validation of project name

    ide.serializer.isCollectingMedia = true;
    pdata = ide.serializer.serialize(ide.stage);
    media = ide.hasChangedMedia ?
            ide.serializer.mediaXML(ide.projectName) : null;
    ide.serializer.isCollectingMedia = false;
    ide.serializer.flushMedia();

    // check if serialized data can be parsed back again
    try {
        ide.serializer.parse(pdata);
    } catch (err) {
        ide.showMessage('Serialization of program data failed:\n' + err);
        throw new Error('Serialization of program data failed:\n' + err);
    }
    if (media !== null) {
        try {
            ide.serializer.parse(media);
        } catch (err) {
            ide.showMessage('Serialization of media failed:\n' + err);
            throw new Error('Serialization of media failed:\n' + err);
        }
    }
    ide.serializer.isCollectingMedia = false;
    ide.serializer.flushMedia();

    myself.getProjectList(
            function (projects) {
                var exists = false;

                projects.forEach(function (project) {
                    if (project.ProjectName.indexOf(repoName) > -1) {
                        exists = true;
                        return;
                    }
                });

                if (exists === false){
                    myself.gh.getUser().createRepo(repoName, { // these should be discussed
                        'description': 'Snap! Project - http://snap.berkeley.edu/snapsource/snap.html#github:Username=' + myself.username + '&projectName=' + repoName,
                        'has_wiki': 'false',
                        'has_downloads': 'false',
                        'auto_init': true,
                        'license_template': 'mit' // discuss
                    }).then(
                        function () {},
                        function (error) {
                            errorCall.call(this, error, 'GitHub');
                        }
                    );
                }

                if (myself.gh !== null) {
                    var repo = myself.gh.getRepo(myself.username, ide.projectName);
                    var branch = repo.getBranch(); // master (default)
                    var message = ''; // TODO optional: specify message

                    var contents = {
                        'snap.xml': pdata,
                        'media.xml': media, // may be binary
                        'README.md': ide.projectNotes
                    };

                    branch.writeMany(contents, message).then(
                        function () {
                            callBack.call();
                        },
                        function (error) {
                            errorCall.call(this, error, 'GitHub');
                        }
                    );
                }
            },
            function (error) {
                errorCall.call(null, error, 'GitHub');
            }
    );
};

GitHubBackend.prototype.getProjectList = function (callBack, errorCall) {
    var myself = this;

    if (myself.gh !== null) {
        myself.gh.getUser().getRepos().then(
                function (repos) {
                    var snapProjects = [];

                    var modCallBack = (function () {
                        var called = 0;
                        return function () {
                            if (++called == repos.length) {
                                callBack.call(myself, snapProjects);
                            }
                        };
                    })();

                    repos.forEach(function (repo) {
                        if (repo.description.indexOf('Snap! Project') > -1) { // TODO nicer detection
                            var project, ghrepo, branch;
                            
                            ghrepo = myself.gh.getRepo(repo.owner.login, repo.name);
                            branch = ghrepo.getBranch(); // master (default)

                            branch.read('README.md', false).then(
                                function (notesContent) {
                                    project = {
                                        'ProjectName': repo.name,
                                        'Notes': notesContent.content,
                                        'Updated': repo.updated_at.replace(/T/, ' ').replace(/Z/, '') // TODO this could be better
                                    };

                                    snapProjects.push(project);
                                    modCallBack();
                                },
                                function (error) {
                                    errorCall.call(this, error, 'GitHub');
                                }
                            );
                        } else {
                            modCallBack();
                        }
                    });
                },
                function (error) {
                    errorCall.call(this, error, 'GitHub');
                }
        );
    } else {
        errorCall.call(myself, localize('Please login'), 'GitHub');
    }
};

GitHubBackend.prototype.logout = function (callBack) {
    this.clear();
};
