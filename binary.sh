#!/bin/bash

if [[ "$snapsource" == "" ]]
then
    export snapsource="https://github.com/Gubolin/snap.git"
fi

if [[ $# < 2 ]]
then
    echo "Usage: binary.sh OPTION PLATFORM [FILE/URL]"
    echo ""
    echo "OPTIONS:"
    echo "  -m      Mobile"
    echo "  -d      Desktop"
    echo ""
    echo "PLATFORMS:"
    echo "  Mobile      amazon-fireos android blackberry10 firefoxos ios ubuntu wp8 win8 tizen"
    echo "  Desktop     win32 win64 osx linux32 linux64"
    echo ""
    echo "If FILE/URL is given, it will be #open-ed inside Snap! immediately. URL will be loaded at runtime."
    echo ""
    echo ""
    echo "The following environment variables will be used, if available:"
    echo "  snapsource  Path or URL to the Snap! git repository. This repository must contain the branch"
    echo "              mobileapp with the configuration files! Default: https://github.com/Gubolin/snap.git"
    echo "  crosswalk   Path to a crosswalk-cordova directory. Download \"Cordova Android\" here:"
    echo "              https://crosswalk-project.org/documentation/downloads.html"
    echo "              If omitted, standard cordova will be used."
    exit 0
fi

scriptdir=$(readlink -e ".")

# Requirements:
# git
# UglifyJS2 (https://github.com/mishoo/UglifyJS2)

ide=true
url=false
platform=$2

# presentation mode
if [[ "$3" != "" ]]
then
    ide=false
fi

if [ $ide == false ]
then
   if [ -f "$3" ]
    then
        content="'$(cat $3)'"
    else
        url=true
    fi
fi

buildsource=$(mktemp -d)
git clone $snapsource $buildsource
cd "$buildsource"
git checkout mobileapp

rm -rf .git/

if [ $ide == false ]
then
    # minimize everything
    rm lang* ypr.js paint.js cloud.js gui.js
    rm -r help/

    sed -i '/paint\.js"/d' snap.html
    sed -i '/cloud\.js"/d' snap.html
    sed -i 's/gui\.js"/binary\.js"/' snap.html

    # load custom project from file or url
    if [ $url == false ]
    then
        sed -i '/sha512\.js"/a\
                <script type="text/javascript" src="code.js"></script> ' snap.html

        echo "var code =" > code.js
        echo "$content" >> code.js
        echo ";" >> code.js

        sed -i "/ide\.openIn/a\
            ide.droppedText(code); " snap.html
    else
        sed -i "/ide\.openIn/a\
            ide.droppedText(ide.getURL('$3')); " snap.html
    fi

else
    rm binary.js
fi

# compress all js files
find . -name '*.js' | xargs -I {} uglifyjs {} -o {} -c

# return to the directory where the script was called from
cd "$scriptdir"

# run helper scripts for building

if [[ $1 == "-m" ]]
then
    ./mobile.sh "$2" "$buildsource"
else
    ./desktop.sh "$2" "$buildsource"
fi
