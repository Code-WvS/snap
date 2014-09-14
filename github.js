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

/*global modules*/

modules.github = '2014-July-31';

var GitHub = new GitHubBackend();

// GitHubBackend /////////////////////////////////////////////////////////////

function GitHubBackend() {
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
        myself.gh = new Octokat();
    }

    myself.gh.repos(userName, projectName).contents('snap.xml').fetch().then(
        function (file) {
            myself.gh.repos(userName, projectName).commits.fetch().then(
                function (commits) {
                    callBack.call(
                        null,
                        atob(file.content),
                        commits[0].sha
                    );
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

    myself.gh = new Octokat(
        {
            username: username,
            password: password
        }
    );

    if (validateData === true) {
        myself.gh.me.repos.fetch().then(
            function () {
                myself.username = username;
                myself.password = password;

                callBack.call(myself);
            },
            function (error) {
                errorCall.call(this, error, 'GitHub');
            }
        );
    } else {
        myself.username = username;
        myself.password = password;

        callBack.call(myself);
    }
};

GitHubBackend.prototype.saveProject = function (commitMessage, parentCommitSha, ide, callBack, errorCall) {
    var myself = this,
        data;
    var pdata, media;
    var repoName = ide.projectName.replace(/[^\w-]/g, ''); // TODO validation of project name

    ide.serializer.isCollectingMedia = true;
    pdata = ide.serializer.serialize(ide.stage);
    media = ide.hasChangedMedia ?
            ide.serializer.mediaXML(ide.projectName) : null;
    data = '<snapdata>\n' + pdata + '\n' + media + '\n</snapdata>';

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
                if (project.ProjectName.indexOf(repoName) > -1) { // FIXME 1) create "Foobar" 2) create "Foo" -> error
                    // indexOf: bad idea
                    exists = true;
                    return;
                }
            });

            pushChanges = function (codeData, parentCSha) {
                if (myself.gh !== null) {
                    writeChanges = function (code, pcSha) {
                        myself.gh.repos(myself.username, ide.projectName).commits.fetch().then(
                            function (commits) {
                                if (commits[0].sha !== pcSha) { // if the local copy is outdated
                                    myself.gh.repos(myself.username, ide.projectName).contents('snap.xml').fetch({ref: pcSha}).then(
                                        function (parentCodeFile) {
                                            myself.gh.repos(myself.username, ide.projectName).contents('README.md').fetch({ref: pcSha}).then(
                                                function (parentNotesFile) {
                                                    myself.gh.repos(myself.username, ide.projectName).contents('snap.xml').fetch().then(
                                                        function (headCodeFile) {
                                                            myself.gh.repos(myself.username, ide.projectName).contents('README.md').fetch().then(
                                                                function (headNoteFile) {
                                                                    var localCode = codeData, localNotes = ide.projectNotes;
                                                                    var parentCode = atob(parentCodeFile.content), parentNotes = atob(parentNotesFile.content);
                                                                    var headCode = atob(headCodeFile.content), headNotes = atob(headNoteFile.content);
                                                                    var dmp = new diff_match_patch();
                                                                    dmp.Match_Threshold = 0.1;
                                                                    var codeDiff, noteDiff;
                                                                    var codePatch, notePatch;

                                                                    // diff parent <-> local
                                                                    codeDiff = dmp.diff_main(parentCode, localCode);
                                                                    noteDiff = dmp.diff_main(parentNotes, localNotes);
                                                                    codePatch = dmp.patch_make(codeDiff);
                                                                    notePatch = dmp.patch_make(noteDiff);
                                                                    console.log(JSON.stringify(codePatch));//DEBUG
                                                                    // patch (parent<->local) => head
                                                                    localCode = dmp.patch_apply(codePatch, headCode);
                                                                    localNotes = dmp.patch_apply(notePatch, headNotes);
                                                                    console.log('Code patched successfully? ' + localCode[1]);
                                                                    console.log('Notes patched successfully? ' + localNotes[1]);
                                                                    localCode = localCode[0];
                                                                    localNotes = localNotes[0];

                                                                    // perform a `git merge`
                                                                    // TODO TODO TODO 422 Not a fast-forward

                                                                    myself.upload([
                                                                        {
                                                                            "name": "snap.xml",
                                                                            "data": localCode
                                                                        },
                                                                        {
                                                                            "name": "README.md",
                                                                        "data": localNotes
                                                                        }], ide.projectName, commits[0].sha, commitMessage,
                                                                        function (mergecommit) {
                                                                            myself.gh.repos(myself.username, ide.projectName).git.refs('heads/master').update({sha: mergecommit.sha}).then(
                                                                                function () {
                                                                                    callBack.call();
                                                                                }
                                                                            );
                                                                        }
                                                                    );
                                                                }
                                                            );
                                                        }
                                                    );
                                                }
                                            );
                                        }
                                    );
                                } else {
                                    // Fast-forward
                                    myself.upload([
                                        {
                                            "name": "snap.xml",
                                            "data": data
                                        },
                                        {
                                            "name": "README.md",
                                            "data": ide.projectNotes
                                        }], ide.projectName, pcSha, commitMessage,
                                        function (commit) {
                                            myself.gh.repos(myself.username, ide.projectName).git.refs('heads/master').update({sha: commit.sha}).then(
                                                function () {
                                                    callBack.call();
                                                }
                                            );
                                        }
                                    );
                                }
                            }
                        );
                    };

                    if (parentCSha !== null) { // repo was just created
                        writeChanges(codeData, parentCSha);
                    } else {
                        myself.gh.repos(myself.username, ide.projectName).commits.fetch().then(
                            function (commits) {
                                writeChanges(data, commits[0].sha);
                            }
                        );
                    }
                }
            };

            if (exists === false){
                myself.gh.me.repos.create({ // these should be discussed
                    'name': repoName,
                    'description': 'Snap! Project - http://gubolin.github.io/snap/index.html#github:Username=' + myself.username + '&projectName=' + repoName,
                    'has_wiki': 'false',
                    'has_downloads': 'false',
                    'auto_init': true,
                    'license_template': 'mit' // discuss
                }).then(
                    function () {
                        pushChanges(data, null);
                    },
                    function (error) {
                        errorCall.call(this, error, 'GitHub');
                    }
                );
            } else {
                pushChanges(data, parentCommitSha);
            }
        },
        function (error) {
            errorCall.call(null, error, 'GitHub');
        }
    );
};

GitHubBackend.prototype.upload = function (dataArr, projectName, pcSha, commitMessage, callBack) {
    var myself = this;
    var blobShas = [];

    var modCallBack = (function () {
        var called = 0;
        return function () {
            if (++called == dataArr.length) {
                createTree();
            }
        };
    })();

    dataArr.forEach(
        function (data) {
            myself.gh.repos(myself.username, projectName).git.blobs.create({
                "content": data.data,
                "encoding": "utf-8"
            }).then(
                function (blob) {
                    blobShas.push({'sha': blob.sha, 'name': data.name});
                    modCallBack();
                }
            );
        }
    );

    var createTree = function () {
        myself.gh.repos(myself.username, projectName).git.commits(pcSha).fetch().then(
            function (parentCommit) {
                var tree = [];
                blobShas.forEach(
                    function (blob) {
                        tree.push(
                            {
                                "path": blob.name,
                                "mode": "100644",
                                "type": "blob",
                                "sha": blob.sha
                            }
                        );
                    }
                );

                myself.gh.repos(myself.username, projectName).git.trees.create({
                    "tree": tree,
                    "base_tree": parentCommit.tree.sha
                }).then(
                function (tree) {
                        var message = commitMessage ? commitMessage : "Meow!";
                        myself.gh.repos(myself.username, projectName).git.commits.create({
                            "message": message,
                            "tree": tree.sha,
                            "parents": [parentCommit.sha]
                        }).then(callBack);
                    }
                );
            }
        );
    };
};

GitHubBackend.prototype.getProjectList = function (callBack, errorCall) {
    var myself = this;

    if (myself.gh !== null){
        myself.gh.me.repos.fetch().then(
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
                            var project;
                            
                            myself.gh.repos(repo.owner.login, repo.name).contents('README.md').fetch().then(
                                function (notesContent) {
                                    project = {
                                        'ProjectName': repo.name,
                                        'Notes': atob(notesContent.content),
                                        'Updated': repo.updatedAt.toString()
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
        myself.message('You are not logged in');
        return;
    }
};

GitHubBackend.prototype.logout = function (callBack) {
    this.clear();
    callBack.call();
};

// GitHub: user messages (to be overridden)

GitHubBackend.prototype.message = function (string) {
    alert(string);
};
